# Biogas Monitor

Live and historical monitoring for a biogas analyzer, built for an **unattended
week-long deployment at a partner lab (IWK)**. The priority is making sensor
health and data quality *visually obvious at a glance* — drift, sensor faults,
and dropped readings should jump out, not hide in a table.

A research-grade companion app with a calm, oscilloscope/data-logger aesthetic,
dark-mode-first and mobile-first (the primary use case is glancing at a phone
near a digester).

---

## Architecture

```
ESP32  ──(every 30s, webhook)──▶  Google Apps Script  ──▶  Google Sheet ("Data" tab)
                                                                  │
                                                  Sheets API v4 values.get (read-only, API key)
                                                                  │
                                                                  ▼
                                       Node/Express backend  (polls every 30s, in-memory store)
                                          /api/latest  /api/history  /api/export  /api/status
                                                                  │
                                                              same-origin /api
                                                                  ▼
                                          React + TypeScript frontend (Vite, Recharts, Framer Motion)
```

- **The frontend never talks to Google directly.** All data flows through the
  Express backend, which holds the API key and Sheet ID.
- The backend addresses sheet columns **by name**, reading the header row to
  build a name→index map — a future column reorder won't silently break parsing.
- A week of 30-second data (~20k rows) lives comfortably in memory, so
  `/api/history` is a fast in-memory filter rather than a per-request round-trip
  to Google.
- **Auth-ready:** it's a single-operator tool today, but the backend is a plain
  Express app — auth middleware can be added in front of `/api` without a rewrite.

### Expected sheet schema (the only format supported, by design)

```
timestamp, mq4_1_raw, mq4_2_raw, mq8_1_raw, mq8_2_raw,
mq4_1_comp, mq4_2_comp, mq8_1_comp, mq8_2_comp,
co2_ppm, temp_c, humidity_pct, spike_flag
```

- `*_raw` — unmodified ADC voltage from each MQ sensor (secondary/diagnostic).
- `*_comp` — temperature/humidity drift-compensated voltage (**primary** reading
  that should track real gas signal). `V_comp = V_raw − (a·T + b·RH + c)`.
- `spike_flag = 1` — firmware caught and filtered a same-cycle multi-channel
  electrical glitch; that cycle used the rolling average, not a fresh ADC read.

---

## Quick start

```bash
# from the repo root
npm run install:all          # installs server + client deps

# Terminal 1 — backend
npm run dev:server           # http://localhost:4000

# Terminal 2 — frontend
npm run dev:client           # http://localhost:5173  (proxies /api → :4000)
```

Open **http://localhost:5173**.

> **No credentials? It still runs.** With no `.env`, the backend starts in
> **mock mode** and serves 24h of realistic synthetic data — including a residual
> temperature-coupled channel, a draft event, and a developing sensor fault — so
> every view (and every diagnostic) is demonstrable out of the box.

### Connecting the real Google Sheet

1. In **Google Cloud Console**, create a project, enable the **Google Sheets
   API**, and create an **API key** (read-only is fine).
2. Share the Sheet as **“Anyone with the link → Viewer”** (or publish it).
3. Copy `server/.env.example` to `server/.env` and fill in:

   ```ini
   SHEET_ID=your_sheet_id_here          # the long id in the sheet URL
   SHEETS_API_KEY=your_api_key_here
   SHEET_RANGE=Data                     # tab name (default)
   POLL_INTERVAL_MS=30000               # 30s
   PORT=4000
   ```

4. Restart the backend. It will leave mock mode automatically and begin polling
   the live sheet. Verify with:

   ```bash
   curl http://localhost:4000/api/status      # source should read "sheet"
   curl http://localhost:4000/api/latest
   ```

`.env` is git-ignored — credentials are never committed or hardcoded.

---

## The views

### 1 · Live Dashboard
Current value + 1-hour sparkline for all four MQ channels (compensated by
default, **raw togglable** as a clearly-labelled overlay), plus CO₂, temperature
and humidity. Numbers tween to new values, sparklines draw in, status colours
ease between states, and a subtle pulse marks each fresh row. If no new row
arrives for **>90 s (2 missed cycles)** the affected cards shift to a stale state
(colour + icon + pulse) and a banner appears. Rows with `spike_flag=1` get a
small, non-alarming **“glitch filtered”** badge.

### 2 · Trends
Full-history line charts. Multi-select any channel’s **comp and/or raw** trace,
overlay a single environment metric on a dedicated right axis, pick a range
(1H–7D), and **drag on the chart to zoom**. The app-wide unit toggle applies here.

### 3 · Data Quality & Diagnostics *(the critical view for the IWK week)*
- **Overall data health badge** — worst-of rollup of everything below, for a
  one-glance remote check.
- **Temperature coupling** — rolling `r` between `temp_c` and each `*_comp`
  channel. Post-compensation this should be *low*; a high `|r|` is now itself the
  alarm (compensation may need refitting). Green `<0.4`, amber `0.4–0.7`, red `>0.7`.
- **Uncaught spike detector** — flags `|Δ| > 5×` the rolling-median Δ on
  compensated channels, *excluding* rows the firmware already caught. Each hit
  has a **“view on chart”** jump-to link.
- **Disturbance classifier** — distinguishes (a) **thermal drift**, (b) **draft /
  door / breath** (informational), and (c) **sensor fault** — sibling divergence,
  which escalates to **red/urgent** as it implies hardware failure.
- **Sensor-pair agreement** — `mq4_1/mq4_2` and `mq8_1/mq8_2` comp ratios over
  time, red if they drift outside the established band.

### 4 · Export
CSV download for any range (presets or a custom date range), including raw,
comp, and `spike_flag` columns in the sheet’s canonical order — ready for
offline analysis and IWK calibration comparison.

### 5 · Calibrated Readings *(placeholder, hooks only)*
Reserved for the future trained gas-fraction regression model (true CH₄%/H₂%
from IWK-calibrated data). Kept **visually and textually distinct** from the
PPM/% unit toggle so the datasheet estimate is never mistaken for the real model.

---

## Units

A global switcher (**Voltage / PPM / Percent**) applies app-wide and persists for
the session. MQ channels default to **compensated**; raw is a labelled overlay.

> **PPM and Percent for the MQ channels are a datasheet approximation from
> voltage — NOT a calibrated gas model.** Anywhere an estimated value appears it
> carries an *“(estimated — datasheet approximation, not yet calibrated against
> lab equipment)”* label. CO₂ is native ppm with an optional `%` toggle (ppm/10000).

---

## Configuration & thresholds

All status thresholds (stale timeout, MQ voltage envelope, CO₂/temp/humidity
bands, correlation cut-offs, spike factor, pair-ratio tolerances) live in **one
file** so the deployment can be tuned without hunting through components:

- Frontend: [`client/src/lib/constants.ts`](client/src/lib/constants.ts)
- Backend: [`server/.env`](server/.env.example) (poll cadence, sheet range)

## Accessibility & motion

- Status is always conveyed by **shape + icon**, not colour alone (color-blind
  safe).
- All motion respects **`prefers-reduced-motion`** (honoured in both CSS and via
  Framer Motion).
- Dark-mode-first, mobile-first responsive layout with a bottom tab bar on phones.

## Project layout

```
server/   Express + TypeScript — Sheets polling, in-memory store, REST API, mock generator
client/   Vite + React + TypeScript — Tailwind, Recharts, Framer Motion
```
