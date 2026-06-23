import {
  CORRELATION,
  MQ_CHANNELS,
  PAIR_RATIO,
  SENSOR_PAIRS,
  SPIKE,
} from "./constants";
import { CompKey, Reading, StatusLevel } from "./types";

export type DiagLevel = "green" | "amber" | "red";

/** Worst-of rollup helper. */
const RANK: Record<DiagLevel, number> = { green: 0, amber: 1, red: 2 };
export function worst(...levels: DiagLevel[]): DiagLevel {
  return levels.reduce((acc, l) => (RANK[l] > RANK[acc] ? l : acc), "green");
}

export function statusToDiag(s: StatusLevel): DiagLevel {
  if (s === "nominal") return "green";
  if (s === "drift") return "amber";
  return "red";
}

// ── Pearson correlation ──────────────────────────────────────────────────────
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    count = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i],
      y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    count++;
  }
  if (count < 2) return NaN;
  const cov = sxy - (sx * sy) / count;
  const vx = sxx - (sx * sx) / count;
  const vy = syy - (sy * sy) / count;
  const denom = Math.sqrt(vx * vy);
  if (denom === 0) return 0;
  return cov / denom;
}

// ── Temperature correlation per compensated channel ──────────────────────────
export interface TempCorrelation {
  channelId: string;
  label: string;
  comp: CompKey;
  r: number;
  level: DiagLevel;
  /** Plain-language interpretation for the operator. */
  note: string;
  samples: number;
}

export function tempCorrelations(rows: Reading[]): TempCorrelation[] {
  const temps = rows.map((r) => r.temp_c);
  return MQ_CHANNELS.map((ch) => {
    const series = rows.map((r) => r[ch.comp]);
    const r = pearson(temps, series);
    const absr = Math.abs(r);
    let level: DiagLevel = "green";
    let note: string;
    const samples = rows.length;

    if (samples < CORRELATION.minSamples || !Number.isFinite(r)) {
      level = "green";
      note = `Not enough data yet (${samples} pts) to assess temperature coupling.`;
    } else if (absr < CORRELATION.greenBelow) {
      level = "green";
      note = `Decoupled from temperature (r=${r.toFixed(
        2
      )}) — compensation is working.`;
    } else if (absr < CORRELATION.amberBelow) {
      level = "amber";
      note = `${ch.label} shows residual temperature coupling (r=${r.toFixed(
        2
      )}) — watch for compensation drift.`;
    } else {
      level = "red";
      note = `${ch.label} still temperature-correlated after compensation (r=${r.toFixed(
        2
      )}) — compensation may need refitting for current conditions.`;
    }
    return { channelId: ch.id, label: ch.label, comp: ch.comp, r, level, note, samples };
  });
}

// ── Uncaught spike detector on *_comp ────────────────────────────────────────
export interface SpikeHit {
  ts: number;
  channelId: string;
  label: string;
  comp: CompKey;
  delta: number;
  medianDelta: number;
  ratio: number;
}

function rollingMedian(values: number[], i: number, window: number): number {
  const half = Math.floor(window / 2);
  const lo = Math.max(0, i - half);
  const hi = Math.min(values.length, i + half + 1);
  const slice = values
    .slice(lo, hi)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!slice.length) return NaN;
  const mid = Math.floor(slice.length / 2);
  return slice.length % 2 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2;
}

/**
 * Flags readings whose |Δ from previous row| exceeds SPIKE.factor × the rolling
 * median |Δ| for that channel. Rows the firmware already caught (spike_flag=1)
 * are excluded — this is the net to catch anything NEW/uncaught.
 */
export function detectSpikes(rows: Reading[]): SpikeHit[] {
  const hits: SpikeHit[] = [];
  if (rows.length < 3) return hits;

  for (const ch of MQ_CHANNELS) {
    const series = rows.map((r) => r[ch.comp]);
    const deltas: number[] = series.map((v, i) =>
      i === 0 ? 0 : Math.abs(v - series[i - 1])
    );
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].spike_flag === 1) continue; // firmware already handled it
      const med = rollingMedian(deltas, i, SPIKE.window);
      if (!Number.isFinite(med) || med <= 1e-6) continue;
      const ratio = deltas[i] / med;
      if (ratio > SPIKE.factor) {
        hits.push({
          ts: rows[i].ts,
          channelId: ch.id,
          label: ch.label,
          comp: ch.comp,
          delta: deltas[i],
          medianDelta: med,
          ratio,
        });
      }
    }
  }
  return hits.sort((a, b) => b.ts - a.ts);
}

// ── Sensor-pair agreement ────────────────────────────────────────────────────
export interface PairAgreement {
  sensor: string;
  aLabel: string;
  bLabel: string;
  aId: string;
  bId: string;
  ratio: number; // latest A/B on comp channels
  level: DiagLevel;
  note: string;
  /** Time series of ratio for plotting. */
  series: { ts: number; ratio: number }[];
}

export function pairAgreements(rows: Reading[]): PairAgreement[] {
  return SENSOR_PAIRS.map(({ sensor, gasName, a, b }) => {
    const series = rows
      .map((r) => {
        const bv = r[b.comp];
        return { ts: r.ts, ratio: bv !== 0 ? r[a.comp] / bv : NaN };
      })
      .filter((p) => Number.isFinite(p.ratio));
    const ratio = series.length ? series[series.length - 1].ratio : NaN;
    const dev = Math.abs(ratio - 1);
    const pairLabel = `${gasName} (${sensor})`;
    let level: DiagLevel = "green";
    let note: string;
    if (!Number.isFinite(ratio)) {
      note = "No data.";
    } else if (dev <= PAIR_RATIO.amberDelta) {
      level = "green";
      note = `${a.label} and ${b.label} agree (ratio ${ratio.toFixed(2)}).`;
    } else if (dev <= PAIR_RATIO.faultDelta) {
      level = "amber";
      note = `${pairLabel} pair diverging (ratio ${ratio.toFixed(
        2
      )}) — monitor for a developing fault.`;
    } else {
      level = "red";
      note = `${pairLabel} pair ratio ${ratio.toFixed(
        2
      )} is outside its established range — possible single-sensor fault.`;
    }
    return {
      sensor,
      aLabel: a.label,
      bLabel: b.label,
      aId: a.id,
      bId: b.id,
      ratio,
      level,
      note,
      series,
    };
  });
}

// ── Disturbance classifier ───────────────────────────────────────────────────
export type DisturbanceKind =
  | "thermal-drift"
  | "draft"
  | "sensor-fault"
  | "none";

export interface Disturbance {
  kind: DisturbanceKind;
  level: DiagLevel;
  title: string;
  detail: string;
}

/** Least-squares slope of y over index (per-sample). */
function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  let ym = 0;
  for (const v of values) ym += v;
  ym /= n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (values[i] - ym);
    den += (i - xm) * (i - xm);
  }
  return den === 0 ? 0 : num / den;
}

function normalizedRange(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  const max = Math.max(...finite);
  const min = Math.min(...finite);
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length || 1;
  return (max - min) / Math.abs(mean || 1);
}

/**
 * Classify what's happening in the most recent window. Distinguishes:
 *  a) thermal drift  — slow multi-channel co-drift WITH temp also drifting.
 *  b) draft/door/breath — fast (<~10min) co-rise in CO2 AND an MQ raw channel,
 *     with NO matching slow temp trend. Informational.
 *  c) sensor fault — one channel diverging from its sibling while the other is
 *     normal. Escalates to red.
 * Returns every pattern it can justify, worst-first.
 */
export function classifyDisturbances(
  rows: Reading[],
  stepMs = 30_000
): Disturbance[] {
  const out: Disturbance[] = [];
  if (rows.length < 6) return out;

  // Windows sized by time, falling back to available data.
  const tail = (mins: number) => {
    const cutoff = rows[rows.length - 1].ts - mins * 60_000;
    const w = rows.filter((r) => r.ts >= cutoff);
    return w.length >= 4 ? w : rows.slice(-Math.min(rows.length, 8));
  };

  // ── (c) Sensor fault: sibling divergence ──
  for (const { sensor, gasName, a, b } of SENSOR_PAIRS) {
    const w = tail(30);
    const sa = w.map((r) => r[a.comp]);
    const sb = w.map((r) => r[b.comp]);
    const aChange = Math.abs(sa[sa.length - 1] - sa[0]);
    const bChange = Math.abs(sb[sb.length - 1] - sb[0]);
    const sep = Math.abs(
      sa[sa.length - 1] - sb[sb.length - 1] - (sa[0] - sb[0])
    );
    const moverChange = Math.max(aChange, bChange);
    const stayChange = Math.min(aChange, bChange);
    // One sibling moved meaningfully, the separation grew, the other held.
    if (sep > 0.08 && moverChange > 3 * (stayChange + 1e-3) && moverChange > 0.08) {
      const mover = aChange >= bChange ? a : b;
      out.push({
        kind: "sensor-fault",
        level: "red",
        title: "Possible sensor fault",
        detail: `${mover.label} is diverging from its sibling on the ${gasName} (${sensor}) pair while the other reads normally — this pattern suggests hardware failure rather than environment. Investigate the sensor.`,
      });
    }
  }

  // ── (b) Draft / door / breath: fast CO2 + MQ raw co-rise, no temp trend ──
  {
    const w = tail(10);
    const co2 = w.map((r) => r.co2_ppm);
    const temp = w.map((r) => r.temp_c);
    const co2Rise = normalizedRange(co2);
    const tempSlopePerMin =
      (slope(temp) * 60_000) / stepMs; // °C per minute
    const rawRises = MQ_CHANNELS.map((ch) =>
      normalizedRange(w.map((r) => r[ch.raw]))
    );
    const anyRawRise = rawRises.some((v) => v > 0.04);
    if (co2Rise > 0.12 && anyRawRise && Math.abs(tempSlopePerMin) < 0.05) {
      out.push({
        kind: "draft",
        level: "amber",
        title: "Possible disturbance (draft / door / breath near sensor)",
        detail: `A fast co-rise in CO₂ and an MQ raw channel with no matching temperature trend — typical of someone opening a door or breathing near the sensor. Informational, not a fault.`,
      });
    }
  }

  // ── (a) Thermal drift: slow multi-channel co-drift with temp drifting ──
  {
    const w = tail(60);
    const tempSlopePerMin = (slope(w.map((r) => r.temp_c)) * 60_000) / stepMs;
    // Count comp channels co-drifting in step with the temp trend.
    let coDrift = 0;
    for (const ch of MQ_CHANNELS) {
      const s = (slope(w.map((r) => r[ch.comp])) * 60_000) / stepMs;
      if (Math.abs(s) > 0.0008 && Math.sign(s) === Math.sign(tempSlopePerMin))
        coDrift++;
    }
    if (Math.abs(tempSlopePerMin) > 0.01 && coDrift >= 3) {
      out.push({
        kind: "thermal-drift",
        level: "amber",
        title: "Thermal drift",
        detail: `Slow multi-channel co-drift tracking a ${
          tempSlopePerMin > 0 ? "rising" : "falling"
        } temperature trend (${tempSlopePerMin.toFixed(
          3
        )} °C/min). Expected — but it should mostly be removed from the compensated channels; persistent drift hints compensation needs refitting.`,
      });
    }
  }

  return out.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

// ── Overall health rollup ────────────────────────────────────────────────────
export interface HealthRollup {
  level: DiagLevel;
  reasons: string[];
}

export function overallHealth(
  liveStatus: DiagLevel,
  correlations: TempCorrelation[],
  spikes: SpikeHit[],
  pairs: PairAgreement[],
  disturbances: Disturbance[]
): HealthRollup {
  const reasons: string[] = [];
  let level = liveStatus;
  if (liveStatus !== "green") reasons.push("Live feed not fully nominal.");

  for (const c of correlations) {
    if (c.level !== "green") {
      level = worst(level, c.level);
      reasons.push(c.note);
    }
  }
  for (const p of pairs) {
    if (p.level !== "green") {
      level = worst(level, p.level);
      reasons.push(p.note);
    }
  }
  for (const d of disturbances) {
    level = worst(level, d.level);
    reasons.push(`${d.title}.`);
  }
  if (spikes.length) {
    level = worst(level, "amber");
    reasons.push(`${spikes.length} uncaught spike(s) detected on compensated channels.`);
  }
  if (!reasons.length) reasons.push("All systems nominal.");
  return { level, reasons };
}
