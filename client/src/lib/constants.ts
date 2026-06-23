import { CompKey, MqSensorType, RawKey } from "./types";

/**
 * ── Single source of truth for thresholds ──────────────────────────────────
 * Everything that decides green/amber/red lives here so the IWK operators can
 * tune the deployment without hunting through components.
 */

/** No fresh row for this long ⇒ the feed is considered stale/offline.
 *  90s = two missed 30s cycles. */
export const STALE_AFTER_MS = 90_000;

/** Poll cadence for the live feed from our own backend (not the sheet). */
export const LIVE_POLL_MS = 5_000;

/** MQ channel operating envelope, in volts, on the COMPENSATED channel.
 *  Note: *_comp is a drift-corrected residual (V_raw − (a·T + b·RH + c)), so it
 *  sits near 0 in clean air and rises with gas — it can even go slightly
 *  negative. The envelope is therefore centred on 0, not on an absolute sensor
 *  voltage: it's here to catch a railed/dead channel (stuck near the ADC rails
 *  or wildly out of band), not to gate the normal near-zero baseline.
 *  Outside [min,max] ⇒ red (out of range). Within `nearBand` of either edge ⇒
 *  amber (drifting / near threshold). Tune to the deployment as calibration
 *  data accrues. */
export const MQ_VOLTAGE = {
  min: -0.6,
  max: 3.4,
  nearBand: 0.25,
};

/** CO2 envelope in ppm. Indoor lab air ~400-1000; digester headspace higher. */
export const CO2_PPM = {
  min: 350,
  amber: 5_000,
  max: 40_000,
};

export const TEMP_C = { min: 5, amber: 35, max: 45 };
export const HUMIDITY_PCT = { min: 10, amber: 85, max: 95 };

/** Diagnostics thresholds. */
export const CORRELATION = {
  // |r| between temp_c and a *_comp channel. Post-compensation we WANT this low.
  greenBelow: 0.4,
  amberBelow: 0.7, // >= 0.7 ⇒ red (compensation likely needs refitting)
  minSamples: 12, // need at least this many points for a meaningful r
};

/** Uncaught-spike detector: flag |Δ| > factor × rolling-median |Δ|. */
export const SPIKE = {
  factor: 5,
  window: 21, // rolling window (samples) for the median delta
};

/**
 * Measured post-compensation residual noise floor per channel, volts — from a
 * sealed-chamber, clean-air, no-gas, 2h17m baseline run. This is the smallest
 * change that could mean anything on that channel; anything smaller is noise,
 * not signal. Used to gate the spike detector and the control-baseline delta
 * display so neither one reports a sub-noise wiggle as a real event.
 */
export const NOISE_FLOOR_V: Record<MqChannel["id"], number> = {
  mq4_1: 0.0011,
  mq4_2: 0.0017,
  mq8_1: 0.0006,
  mq8_2: 0.0022,
};

/** How many multiples of a channel's own noise floor a change must clear
 *  before it's treated as a real (not noise) event. */
export const NOISE_FLOOR_GATE = 3;

/**
 * The temp/humidity envelope the firmware's per-channel compensation formula
 * was actually FIT across (sealed-chamber baseline test). Outside this range,
 * compensation accuracy is not validated — comp values and any correlation
 * drawn from them deserve a visible caveat, not full-confidence treatment.
 */
export const CALIBRATED_RANGE = {
  tempMin: 33.3,
  tempMax: 35.0,
  humidityMin: 53,
  humidityMax: 59,
};

/** Sensor-pair agreement: established ratio range for siblings (comp channels).
 *  Outside ⇒ red (possible single-sensor fault). */
export const PAIR_RATIO = {
  // ratio = A / B; siblings should track ~1.0. Tolerance is generous to avoid
  // noise alarms but tight enough to catch a real divergence.
  amberDelta: 0.12, // |ratio-1| in this band ⇒ amber
  faultDelta: 0.22, // beyond ⇒ red
};

/**
 * Adaptive "control" baseline detector (Live Dashboard). There's no hardcoded
 * reference concentration — instead we treat a long enough FLAT stretch of a
 * channel as its current "controlled environment" reading, and report how far
 * the live value has moved from it. If conditions genuinely shift and hold
 * steady at a new level for `minStableMs`, the baseline adopts that new level
 * automatically — it tracks whatever "normal" currently is, rather than a
 * fixed constant from first boot.
 */
export const BASELINE = {
  /** How far back to look for a qualifying stable plateau. */
  lookbackMs: 6 * 3_600_000, // 6h
  /** A plateau must hold for at least this long to count as "control" data. */
  minStableMs: 20 * 60_000, // 20 min
  /** A candidate window counts as flat if its [min,max] spread stays within
   *  this multiple of the channel's own sample-to-sample noise (median |Δ|
   *  over the lookback window) — so the detector self-calibrates to each
   *  channel's noise floor instead of a hardcoded absolute band. */
  stableBandFactor: 6,
  /** Need at least this many samples before attempting detection at all. */
  minSamples: 10,
  /** How often the lookback window slides forward. */
  refreshMs: 60_000,
};

/** Which real-world gas each sensor model targets — shown alongside the
 *  MQ-4/MQ-8 model number so a non-specialist viewer knows what's being read. */
export const GAS_INFO: Record<MqSensorType, { name: string; formula: string }> = {
  "MQ-4": { name: "Methane", formula: "CH₄" },
  "MQ-8": { name: "Hydrogen", formula: "H₂" },
};

// ── Channel registry ────────────────────────────────────────────────────────
export interface MqChannel {
  id: "mq4_1" | "mq4_2" | "mq8_1" | "mq8_2";
  /** Layman-first label, e.g. "Methane #1". */
  label: string;
  short: string;
  sensor: MqSensorType;
  gasName: string;
  gasFormula: string;
  comp: CompKey;
  raw: RawKey;
  pairWith: MqChannel["id"];
  /** Stable trace color for charts. */
  color: string;
}

export const MQ_CHANNELS: MqChannel[] = [
  {
    id: "mq4_1",
    label: "Methane #1",
    short: "CH₄·1",
    sensor: "MQ-4",
    gasName: GAS_INFO["MQ-4"].name,
    gasFormula: GAS_INFO["MQ-4"].formula,
    comp: "mq4_1_comp",
    raw: "mq4_1_raw",
    pairWith: "mq4_2",
    color: "#38e8c8",
  },
  {
    id: "mq4_2",
    label: "Methane #2",
    short: "CH₄·2",
    sensor: "MQ-4",
    gasName: GAS_INFO["MQ-4"].name,
    gasFormula: GAS_INFO["MQ-4"].formula,
    comp: "mq4_2_comp",
    raw: "mq4_2_raw",
    pairWith: "mq4_1",
    color: "#7dd3fc",
  },
  {
    id: "mq8_1",
    label: "Hydrogen #1",
    short: "H₂·1",
    sensor: "MQ-8",
    gasName: GAS_INFO["MQ-8"].name,
    gasFormula: GAS_INFO["MQ-8"].formula,
    comp: "mq8_1_comp",
    raw: "mq8_1_raw",
    pairWith: "mq8_2",
    color: "#c4b5fd",
  },
  {
    id: "mq8_2",
    label: "Hydrogen #2",
    short: "H₂·2",
    sensor: "MQ-8",
    gasName: GAS_INFO["MQ-8"].name,
    gasFormula: GAS_INFO["MQ-8"].formula,
    comp: "mq8_2_comp",
    raw: "mq8_2_raw",
    pairWith: "mq8_1",
    color: "#f0abfc",
  },
];

export const SENSOR_PAIRS: Array<{
  sensor: MqSensorType;
  gasName: string;
  a: MqChannel;
  b: MqChannel;
}> = [
  {
    sensor: "MQ-4",
    gasName: GAS_INFO["MQ-4"].name,
    a: MQ_CHANNELS[0],
    b: MQ_CHANNELS[1],
  },
  {
    sensor: "MQ-8",
    gasName: GAS_INFO["MQ-8"].name,
    a: MQ_CHANNELS[2],
    b: MQ_CHANNELS[3],
  },
];

export const ENV_COLORS = {
  co2: "#fbbf24",
  temp: "#fb7185",
  humidity: "#60a5fa",
};
