# SUBSENTINEL — Hardware Integration Guide

> **This is a prototype and demonstration platform.** Nothing in this
> document, and no output of the S³ Engine, constitutes a certified
> real-world mine safety prediction or monitoring system. It is a proof of
> concept for how ESP32 + LoRa field hardware could eventually feed a risk
> dashboard.

This guide explains exactly how the future gateway should talk to the
SUBSENTINEL backend once the ESP32 + MPU6050 + ADXL345 + VL53L0X + LoRa
hardware exists. Today, nothing is connected — the dashboard runs entirely
on simulated data (**Simulation Mode**) until you switch it to **Hardware
Mode** and start sending real readings.

```
Node A ─┐
Node B ─┤
Node C ─┼──> Gateway (ESP32 + LoRa) ───> Backend API ───> Dashboard
Node D ─┘         (Wi-Fi, HTTP POST)     (server/)         (src/)
```

## Running the backend

```bash
npm install
npm run server     # starts the backend on http://localhost:8787
npm run dev         # in a second terminal — the Vite dashboard on :5173
```

The dashboard's dev server proxies `/api/*` to `http://localhost:8787`
(see `vite.config.ts`), so no CORS configuration is needed in development.
The backend also sends permissive CORS headers itself, so you can hit it
directly with `curl`/Postman/the real gateway from any origin.

The backend has **zero npm dependencies** of its own — it's built on
Node's `http` module — so `npm run server` needs nothing beyond
`node_modules/tsx` (already in `devDependencies`) to run.

## Switching Simulation Mode → Hardware Mode

1. Open the dashboard → **Configuration** tab → **System Mode**.
2. Select **Hardware Mode**. The dashboard stops using the built-in
   simulator and instead connects to the backend's live telemetry stream,
   waiting for real data.
3. Until the gateway starts posting, all four nodes hold their last-known
   (or seeded baseline) values — the dashboard does not fabricate data in
   Hardware Mode.
4. Send telemetry (see below). Each `POST /api/telemetry` updates the
   dashboard in real time — no page refresh needed.

You can switch back to **Simulation Mode** at any time; the backend keeps
running and keeps accepting telemetry either way; the mode selector only
controls what the *dashboard* trusts and displays as "live."

## API endpoint

```
POST /api/telemetry
Content-Type: application/json
```

### Request body

```json
{
  "nodeId": "D",
  "timestamp": "2026-08-30T12:00:00Z",
  "tilt": 2.4,
  "vibration": 1.8,
  "displacement": 6.1,
  "crackMovement": 0.32
}
```

| Field           | Type   | Required | Units                                   | Reasonable range | Notes                              |
|-----------------|--------|----------|------------------------------------------|-------------------|-------------------------------------|
| `nodeId`        | string | yes      | —                                        | —                 | Must be one of `"A"`, `"B"`, `"C"`, `"D"` |
| `timestamp`     | string | yes      | ISO 8601                                 | —                 | e.g. `2026-08-30T12:00:00Z`        |
| `tilt`          | number | yes      | degrees                                  | 0–90              | From the MPU6050                   |
| `vibration`     | number | yes      | normalized prototype value (unitless)    | 0–50              | Derived from the ADXL345           |
| `displacement`  | number | yes      | millimeters                              | 0–1000            | From the VL53L0X prototype rig     |
| `crackMovement` | number | yes      | millimeters                              | 0–200             | From the crack/displacement mechanism |

All four numeric fields must be finite numbers within their reasonable
range (see `server/validate.ts`). Missing, invalid, negative, or
wildly-out-of-range fields are rejected with a `400` response listing
every problem found (not just the first one), so a gateway with a bug in
its payload gets a complete diagnostic in one round trip. Invalid data is
always rejected safely — it never crashes the server and never corrupts
that node's stored readings.

### Example request

```bash
curl -X POST http://localhost:8787/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "D",
    "timestamp": "2026-08-30T12:00:00Z",
    "tilt": 2.4,
    "vibration": 1.8,
    "displacement": 6.1,
    "crackMovement": 0.32
  }'
```

### Success response — `200 OK`

```json
{
  "ok": true,
  "nodeId": "D",
  "risk": {
    "score": 38,
    "status": "WARNING",
    "confidence": 71,
    "trend": "RISING",
    "reasons": ["Increasing ground tilt"],
    "neighbourComparison": { "averageNeighbourRisk": 12, "delta": 26, "isLocalizedAnomaly": true }
  },
  "alert": null
}
```

`alert` is populated (not `null`) only on the tick where the node's status
band actually changes (e.g. SAFE → WARNING), matching what appears in the
dashboard's Alerts panel.

### Alternate request shape — nested `sensors`

The endpoint also accepts a nested `sensors` object, matching the shape
in this project's hardware-integration brief and common ESP32/gateway JSON
conventions:

```json
{
  "nodeId": "D",
  "timestamp": "2026-08-30T12:00:00Z",
  "sensors": {
    "tilt": 2.4,
    "vibration": 1.8,
    "displacement": 6.1,
    "crack": 0.32
  }
}
```

This is normalized to the exact same `TelemetryData` internally (see
`server/validate.ts`) — it is **not** a second, separately-processed
format, just a convenience shape. Use whichever is easier for your
gateway's firmware to serialize; both produce identical results. Note the
field is `crack` when nested (matching `sensors.crack`) but `crackMovement`
when flat — both mean the same measurement.

### Validation error — `400 Bad Request`

```json
{
  "ok": false,
  "errors": [
    "\"nodeId\" is required and must be one of: A, B, C, D.",
    "\"tilt\" is required and must be a finite number (nested \"sensors.tilt\" is also accepted)."
  ]
}
```

Every numeric field is also checked against a generous "reasonable
prototype range" (e.g. tilt 0–90°, vibration 0–50, displacement 0–1000mm,
crackMovement 0–200mm — see `server/validate.ts`). This exists only to
catch obviously garbage payloads (a misconfigured sensor reporting
`999999`); it is well above the CRITICAL thresholds in
`shared/data/sensors.ts`, so a real anomalous reading — which is exactly
what this system exists to catch — is never rejected for being "too high."
A rejected payload never crashes the server and never updates that node's
readings; if the payload named a real, recognized `nodeId`, it does mark
that node's **connection status** as `ERROR` (see below) so the dashboard
can tell "bad data" apart from "no data."

## Node connection status (ONLINE / STALE / OFFLINE / ERROR)

Separately from a node's **risk** status (SAFE/WARNING/CRITICAL, from the
S³ Engine), the backend tracks each node's **hardware link health** — is
the gateway actually still reporting in? This is independent of risk: a
node can be geotechnically SAFE while its sensor has gone quiet, or
CRITICAL while still very much online.

| Status    | Meaning                                                                 |
|-----------|--------------------------------------------------------------------------|
| `ONLINE`  | A valid reading arrived within the last 30s (`STALE_AFTER_MS`).          |
| `STALE`   | No valid reading for 30–90s. Dashboard shows the last-known values.      |
| `OFFLINE` | No valid reading for 90s+ (`OFFLINE_AFTER_MS`) — or none, ever.          |
| `ERROR`   | The most recent payload for this node was received but **rejected** by validation (bad values, malformed fields). The gateway is clearly reachable; the data it sent wasn't usable. |

This logic lives in `server/connectionMonitor.ts` and is deliberately
simple and deterministic — a pure function of "how long since the last
valid reading," recomputed every 5 seconds (`SWEEP_INTERVAL_MS`) so a node
going silent is caught even if nothing else happens. All four nodes start
`OFFLINE` at boot (no gateway has reported yet) and move to `ONLINE` the
moment their first valid `POST /api/telemetry` arrives.

Each node's connection info is included on every node object in
`GET /api/snapshot` and every SSE push, as:

```json
{
  "id": "A",
  "...": "...(risk fields as before)...",
  "connection": {
    "status": "ONLINE",
    "lastSeenAt": "2026-08-30T12:00:00Z",
    "lastSeenMsAgo": 4210,
    "lastError": null
  }
}
```

`connection` is optional on the shared `MonitoringNode` type — it's only
populated by the backend (HARDWARE-mode data), so SIMULATION-mode
snapshots (generated client-side) simply omit it. This was an additive,
backend-only change: no existing field was renamed or removed, and nothing
in `src/` had to change to keep working.

For quick debugging without pulling the whole snapshot, there's also:

```
GET /api/connections
```

```json
{
  "connections": {
    "A": { "status": "ONLINE", "lastSeenAt": "2026-08-30T12:00:00Z", "lastSeenMsAgo": 1500, "lastError": null },
    "B": { "status": "OFFLINE", "lastSeenAt": null, "lastSeenMsAgo": null, "lastError": null },
    "C": { "status": "ERROR", "lastSeenAt": null, "lastSeenMsAgo": null, "lastError": ["\"tilt\" of 9999 is outside the reasonable prototype range (0–90)."] },
    "D": { "status": "STALE", "lastSeenAt": "2026-08-30T11:58:10Z", "lastSeenMsAgo": 45000, "lastError": null }
  }
}
```

A real gateway should send each node's reading at a regular interval well
under 30 seconds so its nodes stay `ONLINE` rather than drifting into
`STALE`; adjust `STALE_AFTER_MS`/`OFFLINE_AFTER_MS` in
`server/connectionMonitor.ts` to match your actual report interval.

## Other endpoints

| Method | Path                     | Purpose                                                        |
|--------|--------------------------|------------------------------------------------------------------|
| GET    | `/api/health`            | Liveness check                                                  |
| GET    | `/api/snapshot`          | Full current state (all nodes + connection status, alerts, S³ Engine metrics) |
| GET    | `/api/connections`       | Per-node connection status only (ONLINE/STALE/OFFLINE/ERROR)     |
| GET    | `/api/mode`              | `{ "mode": "SIMULATION" \| "HARDWARE" }`                         |
| POST   | `/api/mode`              | Body `{ "mode": "SIMULATION" \| "HARDWARE" }` — set the mode     |
| GET    | `/api/telemetry/stream`  | Server-Sent Events — one push per update, for the dashboard      |

`GET /api/telemetry/stream` is what the dashboard subscribes to for
real-time updates (via the browser's built-in `EventSource`). A gateway
integration doesn't need to touch this endpoint — it only ever `POST`s to
`/api/telemetry`.

## Required node IDs

Only `"A"`, `"B"`, `"C"`, and `"D"` are recognized — these correspond to
the four fixed monitoring nodes shown on the dashboard's mine map (North
Face, East Wall, South Bench, Pit Floor). A gateway serving additional
physical nodes would need those node IDs added to
`shared/data/nodes.ts` first.

## How risk is calculated

Every `POST /api/telemetry` is run through the same S³ Engine
(`shared/engine/`) that drives Simulation Mode:

1. Each of the 4 sensor values is scored 0–100 against warn/critical
   thresholds (`shared/data/sensors.ts`).
2. Those scores are weighted and fused into one 0–100 node risk score.
3. Trend (rising/falling/stable) is derived from the node's recent
   history, now including this new reading.
4. The node's risk is compared against the other three nodes' last-known
   risk to detect a localized anomaly.
5. A status band (SAFE 0–34 / WARNING 35–64 / CRITICAL 65–100), a
   confidence percentage, and human-readable reasons come out the other
   end — and an alert is generated automatically if the status band
   changed.

This is a simplified heuristic for demonstration purposes, not a
validated geotechnical model. See the disclaimer in the Configuration tab
and at the top of this document.

## Intelligence layer (adaptive anomaly detection, fusion, explainability)

Alongside the risk score above, every node also carries an `intelligence`
object (`shared/types/sensor.ts` → `IntelligenceResult`, computed by
`shared/engine/intelligenceEngine.ts`) built from the same sensor history —
in both Simulation and Hardware mode, via the same shared engine code:

- **Per-sensor anomaly detection** (`anomalies`) — each sensor's current
  reading compared against its own recent adaptive baseline (mean + std
  deviation), plus its rate of change, producing a 0–100 anomaly score.
- **Multi-sensor fusion** (`fusion`) — how strongly the four sensors agree
  with each other; several sensors trending abnormally together score
  higher than one sensor alone.
- **Explainability** (`explainability`) — a human-readable explanation and
  primary cause generated from the actual anomaly data, not a canned string.
- **Spatial pattern** (`spatial`) — whether this node's anomaly looks
  localized or shared with its neighbours.
- **Short-term trajectory** (`trajectory`) — a transparent linear
  extrapolation of the risk score a few ticks ahead (STABLE / IMPROVING /
  ESCALATING). A prototype trend forecast, not a collapse prediction.

Entirely deterministic — no `Math.random()` anywhere in this layer. Like
`connection`, this is purely additive: existing fields are unchanged, and
nothing in the UI is required to read it.

## Suggested gateway firmware flow (ESP32 + LoRa)

1. Each field node (ESP32 + MPU6050 + ADXL345 + VL53L0X + crack sensor +
   LoRa radio) reads its sensors on an interval and transmits a compact
   payload over LoRa to the gateway.
2. The gateway (ESP32 + LoRa, Wi-Fi-connected) receives each node's
   packet, converts it to the JSON shape above, and `POST`s it to
   `http://<backend-host>:8787/api/telemetry`.
3. Repeat per node, independently — nodes do not need to be synchronized;
   the backend processes each node's updates on its own schedule, which
   matches how real distributed LoRa nodes report.
4. If a POST fails (network hiccup, backend restart), simply retry with
   the next reading — there's no session/handshake to reset.
5. Report each node at least every ~20-25 seconds (comfortably under the
   30s `STALE_AFTER_MS` window) so the dashboard shows it `ONLINE` rather
   than `STALE`. A node that goes quiet for 90s+ is reported `OFFLINE` —
   see "Node connection status" above.

## Prototype limitations — what real deployment would require

This is a Smart India Hackathon **prototype and demonstration platform**.
Nothing here — the risk scores, the alerts, the connection-status
tracking — is a certified real-world mine safety system, and it should
never be used to make an actual safety decision. A genuine field
deployment would additionally require, at minimum:

- Industrial-grade, calibrated sensors (not prototype breakout boards)
- Site-specific calibration of thresholds against real geotechnical data
- Extended field testing across seasons/conditions
- Redundant communication paths (a single LoRa gateway is a single point
  of failure)
- Professional geotechnical/safety-engineering validation and sign-off,
  and compliance with applicable mine safety regulations

Treat every risk score, alert, and connection status in this system as a
demonstration of the *architecture*, not a validated safety judgment.
