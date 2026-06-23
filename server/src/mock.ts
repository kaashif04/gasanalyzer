import { Reading } from "./types.js";

/**
 * Synthetic data generator used when no real sheet is configured. It is not
 * just noise — it is shaped to exercise every diagnostic the UI offers, so the
 * app demos meaningfully out of the box:
 *
 *   - A gentle diurnal temperature swing.
 *   - *_raw channels that track temperature (uncompensated, as expected).
 *   - *_comp channels that are mostly flat (compensation working)...
 *   - ...except mq4_2_comp, which retains some temperature correlation, so the
 *     "still temperature-correlated after compensation" warning fires.
 *   - Occasional firmware spike_flag=1 rows.
 *   - A short "draft" event: fast co-rise in co2 + a raw channel, no temp trend.
 *   - A slow sensor fault late in the window: mq8_1_comp drifts away from its
 *     sibling mq8_2_comp, which should escalate to a red "possible sensor fault".
 */

const STEP_MS = 30_000;
const HISTORY_HOURS = 24;

function tempAt(t: number): number {
  // Diurnal swing around 22°C, period 24h, plus slow wander.
  const hours = t / 3_600_000;
  return (
    22 +
    3 * Math.sin((hours / 24) * 2 * Math.PI - Math.PI / 2) +
    0.4 * Math.sin(hours / 1.7)
  );
}

function humidityAt(t: number, temp: number): number {
  // RH inversely related to temp, plus noise.
  return clamp(55 - (temp - 22) * 2.5 + noise(t, 7) * 1.5, 25, 85);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Deterministic pseudo-noise so a given timestamp always renders the same value.
function noise(t: number, salt: number): number {
  const x = Math.sin(t * 0.000013 + salt * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; // -1..1
}

function buildReading(t: number, nowSpan: number, endTs: number): Reading {
  const temp = tempAt(t);
  const humidity = humidityAt(t, temp);

  // Baselines (volts). MQ-4 (methane) and MQ-8 (hydrogen) sit at different levels.
  const base = { mq4: 1.45, mq8: 0.92 };

  // How temperature pushes a RAW channel around (uncompensated drift).
  const tempEffect = (temp - 22) * 0.045;
  const rhEffect = (humidity - 50) * 0.0009;

  // Real gas signal: deliberately HIGHER-frequency than the 24h temperature
  // cycle (periods of roughly 5-30 min). This keeps the compensated channels
  // genuinely decoupled from temperature — any slow signal would spuriously
  // correlate with the slow temp drift over a multi-hour window, so we avoid
  // one. Only the deliberately under-compensated channel (mq4_2) carries a
  // strong slow temperature term and so lights up the coupling alarm.
  const gas4 = 0.016 * Math.sin(t / 1_600_000) + 0.008 * Math.sin(t / 420_000);
  const gas8 = 0.014 * Math.sin(t / 1_900_000) + 0.007 * Math.sin(t / 520_000);

  // ── Event windows (relative to the end of the series) ──
  const minutesFromEnd = (endTs - t) / 60_000;
  // Draft event: a ~6 minute window centred ~3h before the end.
  const draftCenter = 180;
  const draftActive = Math.abs(minutesFromEnd - draftCenter) < 3;
  const draftBump = draftActive
    ? 0.22 * Math.exp(-Math.pow((minutesFromEnd - draftCenter) / 1.5, 2))
    : 0;
  // Sensor fault: mq8_1 slowly diverges over the final 90 minutes.
  const faultActive = minutesFromEnd < 90;
  const faultDrift = faultActive ? ((90 - minutesFromEnd) / 90) * 0.28 : 0;

  const n = (salt: number) => noise(t, salt) * 0.006;

  // RAW = baseline + gas + full temp/rh drift + noise (+ draft on co-channels).
  const mq4_1_raw = base.mq4 + gas4 + tempEffect + rhEffect + n(1) + draftBump;
  const mq4_2_raw = base.mq4 + gas4 + tempEffect * 0.98 + rhEffect + n(2);
  const mq8_1_raw = base.mq8 + gas8 + tempEffect * 0.9 + rhEffect + n(3) + faultDrift;
  const mq8_2_raw = base.mq8 + gas8 + tempEffect * 0.92 + rhEffect + n(4);

  // COMP = compensation removes most temp/rh drift. mq4_2 keeps ~35% of it
  // (compensation drifting out of fit) so the correlation alarm has something
  // to find. Draft & fault survive compensation (they're real signal changes).
  const mq4_1_comp = base.mq4 + gas4 + tempEffect * 0.05 + n(5) + draftBump * 0.4;
  const mq4_2_comp = base.mq4 + gas4 + tempEffect * 0.35 + n(6);
  const mq8_1_comp = base.mq8 + gas8 + tempEffect * 0.04 + n(7) + faultDrift;
  const mq8_2_comp = base.mq8 + gas8 + tempEffect * 0.05 + n(8);

  // CO2 baseline ~ 800 ppm, slow rise across the window, draft spike. (CO2 is
  // not part of the temperature-coupling test, so a slow trend here is fine.)
  const progress = (t - (endTs - nowSpan)) / nowSpan; // 0..1 across window
  const co2_ppm =
    800 + 600 * progress + 120 * Math.sin(t / 7_000_000) + draftBump * 1800 + noise(t, 9) * 25;

  // Firmware spike: rare, deterministic (~1 in 90 rows).
  const spike_flag = Math.floor(t / STEP_MS) % 90 === 0 ? 1 : 0;

  const round = (v: number, p = 4) => Number(v.toFixed(p));

  return {
    ts: t,
    timestamp: new Date(t).toISOString(),
    mq4_1_raw: round(mq4_1_raw),
    mq4_2_raw: round(mq4_2_raw),
    mq8_1_raw: round(mq8_1_raw),
    mq8_2_raw: round(mq8_2_raw),
    mq4_1_comp: round(mq4_1_comp),
    mq4_2_comp: round(mq4_2_comp),
    mq8_1_comp: round(mq8_1_comp),
    mq8_2_comp: round(mq8_2_comp),
    co2_ppm: round(co2_ppm, 1),
    temp_c: round(temp, 2),
    humidity_pct: round(humidity, 1),
    spike_flag,
  };
}

/** Generate the full backfill from HISTORY_HOURS ago up to `now`. */
export function generateHistory(now = Date.now()): Reading[] {
  const span = HISTORY_HOURS * 3_600_000;
  const start = now - span;
  const readings: Reading[] = [];
  for (let t = start; t <= now; t += STEP_MS) {
    readings.push(buildReading(t, span, now));
  }
  return readings;
}

/** Generate a single fresh reading for the current instant. */
export function generateOne(now = Date.now()): Reading {
  const span = HISTORY_HOURS * 3_600_000;
  return buildReading(now, span, now);
}

export const MOCK_STEP_MS = STEP_MS;
