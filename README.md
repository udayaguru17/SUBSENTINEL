# SUBSENTINEL

**AI-powered IoT mine subsidence early warning dashboard.**
*Detect. Predict. Protect.*

A mobile-first, dark industrial monitoring dashboard built with React, TypeScript, and Vite, backed by a dependency-free Node API and a shared S³ risk engine. Two data source modes: **Simulation Mode** (built-in, runs entirely client-side) and **Hardware Mode** (waits for real telemetry via the backend, ready for an ESP32 + LoRa gateway).

> ⚠️ **Disclaimer:** The risk scoring in this project is a simplified demonstration heuristic. It is **not** a certified real-world mine-safety prediction system. Do not use it for actual safety-critical decisions.

## Getting started

```bash
npm install
npm run dev       # dashboard on http://localhost:5173
npm run server    # (optional, second terminal) backend on http://localhost:8787 — only needed for Hardware Mode
```

```bash
npm run build     # type-checks and builds the frontend for production
npm run preview   # preview the production build locally
npm run lint       # type-check only
```

No authentication, no paid APIs. Simulation Mode needs nothing but `npm run dev` — the backend is only required if you switch to Hardware Mode from the Configuration tab.

## Project structure

```
shared/                          # Framework-agnostic domain logic — used by BOTH frontend and backend
  types/sensor.ts                  # Domain types, SensorDataSource contract, TelemetryData/RiskResult/Alert/SystemMode
  data/                             # nodes.ts, sensors.ts, scenarios.ts, simulationConfig.ts
  engine/                           # S³ ENGINE — pure functions, no React/Node-specific deps
    riskEngine.ts                     # Sensor fusion, scoring, confidence, reasons
    trendAnalysis.ts                   # Slope / rate-of-change / trend direction
    neighbourAnalysis.ts                # Cross-node comparison, anomaly detection
    seed.ts                              # Baseline node/sensor seeding
    alerts.ts                             # Alert severity + message wording
    siteMetrics.ts                         # Site-wide S³ Engine panel metrics
  lib/format.ts                    # Tiny date/time formatting helpers

server/                          # Backend API — plain Node `http`, zero npm dependencies
  index.ts                         # HTTP server + routing
  telemetryProcessor.ts             # Runs incoming telemetry through the shared S³ Engine
  validate.ts                       # POST /api/telemetry payload validation
  state.ts                          # In-memory per-node history (prototype storage)
  sse.ts                            # Server-Sent Events broadcast hub
  http.ts                           # Small request/response helpers

src/                              # Frontend — Vite + React + TypeScript
  types/app.ts                      # UI-level view type (Dashboard / Configuration)
  services/
    simulationService.ts             # SIMULATION mode: client-side ticking data source
    backendDataSource.ts              # HARDWARE mode: talks to server/ via fetch + SSE
  data/sensorIcons.ts                # Frontend-only icon lookup (kept out of shared/)
  hooks/useSubsentinelData.ts        # Owns the active data source, switches on system mode
  components/
    layout/Header.tsx                  # Header + nav + live mode indicator
    dashboard/                          # RiskPanel, RiskGauge, MineMap, NodeRow,
                                         # NodeDetail, SensorTile, TrendChart,
                                         # EnginePanel, AlertsPanel
    configuration/                       # ModePanel (SIMULATION/HARDWARE switch),
                                          # ScenarioPanel (demo scenarios), disclaimer
    ui/                                   # StatusPill, SectionHeading
  App.tsx
  main.tsx

HARDWARE_INTEGRATION.md           # Full gateway API contract for the future ESP32 + LoRa hardware
```

## Live demo: SAFE → WARNING → CRITICAL (Simulation Mode)

Open the **Configuration** tab and pick a scenario under System Mode → Simulation Mode. Telemetry updates every 2–3 seconds, so give each scenario a little time to ramp:

- **Safe** — all four nodes fluctuate normally around their baselines. Expect SAFE status site-wide within a tick or two.
- **Localized Subsidence** — Node D's tilt, displacement, and crack-movement readings drift upward over ~18 ticks (roughly 45–75s) while A, B, and C stay steady. Watch Node D's card climb SAFE → WARNING, usually reaching WARNING/CRITICAL while its neighbours remain calm — the S³ Engine should flag "Localised anomaly compared with neighbouring nodes" in Node D's detail view once it pulls far enough ahead of the others.
- **Critical Event** — Node D ramps to full intensity in ~5 ticks (12–15s) across tilt, vibration, displacement, and crack movement simultaneously, driving it to CRITICAL quickly and firing a CRITICAL alert in the Alerts panel.

Switching scenarios restarts the ramp from zero intensity, so you can replay a scenario or jump straight to Safe to reset the demo.

## SIH Demo Mode (guided live demo)

On the Dashboard tab, click **Start Live Demo**. It runs a guided, judge-facing walkthrough directly on the real dashboard (not a scripted animation — it drives the same `setScenario`/`reset` controls a presenter could click manually):

1. **Normal Condition** — all four nodes SAFE, Overall Risk LOW.
2. **Early Warning** — Node D shows mild abnormal tilt/displacement/vibration, crossing into WARNING.
3. **Localized Subsidence** — Node D becomes clearly abnormal while A/B/C stay stable; the S³ Engine flags a localized anomaly and the neighbour comparison is shown.
4. **Critical Condition** — risk escalates rapidly at Node D; HIGH RISK DETECTED, a CRITICAL alert fires.
5. **System Response** — a summary card: risk score, confidence, affected node, detected factors, and a prototype-safe recommended action.

Each step auto-advances once the data actually shows what it's meant to demonstrate (with a timed fallback so it never visibly stalls). Click **End Live Demo** at any point, or **Reset System** for an instant clean slate. The same four scenarios (Safe / Early Warning / Localized Subsidence / Critical Event) are also available individually under **Manual Controls** for a presenter who wants to jump straight to one condition.

**Presentation Mode** (the expand icon in the header) enlarges the risk score and alerts and hides secondary chrome — meant for a laptop/projector during judging. **How It Works** (header nav) has the sensor→gateway→S³ Engine pipeline diagram and the "Why SUBSENTINEL?" project-impact section for judges.



1. `npm run server` (starts the backend on :8787; the Vite dev server proxies `/api/*` to it automatically).
2. In the dashboard's Configuration tab, switch **System Mode** to **Hardware Mode**.
3. `POST` telemetry to `/api/telemetry` — see **HARDWARE_INTEGRATION.md** for the full request/response contract, example `curl` command, and the eventual ESP32 + LoRa gateway flow. Every accepted reading is pushed to the dashboard instantly over Server-Sent Events — no page refresh needed.

## Connecting real hardware later

Both modes implement the same interface, `SensorDataSource` (`shared/types/sensor.ts`):

```ts
interface SensorDataSource {
  getSnapshot(): SubsentinelSnapshot;
  subscribe(callback: (snapshot: SubsentinelSnapshot) => void): () => void;
  setScenario?(scenario: ScenarioId): void; // SIMULATION only
  stop?(): void;
}
```

- `SimulatedDataSource` (`src/services/simulationService.ts`) — SIMULATION mode.
- `BackendDataSource` (`src/services/backendDataSource.ts`) — HARDWARE mode; fetches `/api/snapshot` then subscribes to `/api/telemetry/stream` (SSE).

`src/hooks/useSubsentinelData.ts` swaps between them when you change System Mode — no other component needs to know or care which one is active. When the real ESP32 + LoRa gateway exists, it talks to `server/` exactly as described in `HARDWARE_INTEGRATION.md`; no frontend changes are needed at all.

## Risk logic — S³ Engine

`shared/engine/riskEngine.ts` (with `trendAnalysis.ts`, `neighbourAnalysis.ts`, `seed.ts`, `alerts.ts`, `siteMetrics.ts`) computes, per node, on every update — whether that update comes from the client simulator's tick or a real `POST /api/telemetry`:

- **Per-sensor risk** — each of the 4 sensors (tilt, vibration, ground displacement, crack movement) maps its reading to a 0–100 score using warn/critical thresholds in `shared/data/sensors.ts`.
- **Node risk score (0–100)** — a weighted fusion of the 4 sensor scores (`RISK_WEIGHTS`). Bands: **0–34 SAFE**, **35–64 WARNING**, **65–100 CRITICAL** (`shared/data/simulationConfig.ts`).
- **Trend direction** — slope of each sensor's recent history, rolled up into a dominant per-node direction (RISING / FALLING / STABLE).
- **Neighbour comparison** — this node's risk vs. the average of the other three; a large positive delta flags a localised anomaly.
- **Confidence (0–100)** — higher when multiple sensors agree something is abnormal, their trends are consistent, and any elevation stands out clearly from neighbouring nodes.
- **Reasons** — human-readable strings ("Increasing ground tilt", "Rapid displacement trend", "Crack movement detected", "Abnormal vibration pattern", "Localised anomaly compared with neighbouring nodes") attached to the node detail view and any alert it triggers.
- **Overall site risk** — a blend of the worst node (60%) and the site average (40%).

Alerts fire automatically whenever a node's status band changes (SAFE ⇄ WARNING ⇄ CRITICAL), each carrying a timestamp, node name, severity, risk score, and the reasons behind it — identically in both modes.

Adjust thresholds, weights, and scenario tuning in `shared/data/` as real calibration data becomes available.

> **Disclaimer:** This is a prototype/demo risk model only — not a certified real-world mine safety prediction system. See the Configuration tab, or `HARDWARE_INTEGRATION.md`, for the same notice.
