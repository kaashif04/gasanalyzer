import {
  CORRELATION,
  DIAGNOSTICS_GAP_MS,
  MQ_CHANNELS,
  NOISE_FLOOR_GATE,
  NOISE_FLOOR_V,
  PAIR_RATIO,
  SENSOR_PAIRS,
  SPIKE,
} from "./constants";
import { activeCalibratedRange, isWithinCalibratedRange } from "./status";
import { calibEpochLabel } from "./format";
import { CompKey, Reading, StatusLevel } from "./types";

export type DiagLevel = "green" | "amber" | "red";

/**
 * Restricts `rows` (assumed ascending by ts) to the most recent continuous
 * run — i.e. trims off anything before the LAST gap exceeding
 * DIAGNOSTICS_GAP_MS. The device is intentionally power-cycled, so a
 * selected time range can easily span a multi-hour/day power-off; comparing
 * the reading right before that gap against the reading right after, as if
 * they were normal consecutive ~30s samples, produces misleading deltas,
 * correlations, and trend windows that reflect the gap itself rather than
 * real sensor behavior. Every diagnostic in this file should be run on the
 * output of this, never on a raw, potentially gap-spanning array.
 */
export function lastContinuousSegment(rows: Reading[]): Reading[] {
  if (rows.length < 2) return rows;
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i].ts - rows[i - 1].ts > DIAGNOSTICS_GAP_MS) {
      return rows.slice(i);
    }
  }
  return rows;
}

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
  /** Fraction (0-1) of this window where temp/humidity were outside the
   *  range the compensation formula was actually validated across. */
  outsideCalibratedFraction: number;
}

/**
 * What fraction of a window's rows were outside THEIR OWN active calibration
 * range (each row carries its own calib_temp_min_c etc., so this stays
 * correct across a recalibration), plus the range/epoch label to quote —
 * shared by every diagnostic below whose reliability degrades when
 * conditions are this far into unvalidated extrapolation territory.
 * Returns null if it's not a big enough fraction to be worth a caveat (a
 * stray sample or two outside the band isn't worth flagging every time).
 */
function calibrationCaveatInfo(
  rows: Reading[]
): { fraction: number; range: ReturnType<typeof activeCalibratedRange>; epochLabel: string } | null {
  if (!rows.length) return null;
  const outsideCount = rows.filter(
    (r) => !isWithinCalibratedRange(r.temp_c, r.humidity_pct, activeCalibratedRange(r))
  ).length;
  const fraction = outsideCount / rows.length;
  if (fraction <= 0.2) return null;

  // Quotes the MOST RECENT row's calibration as "current" — relative to the
  // latest calibration, not a fixed one-time-forever band.
  const latestRow = rows[rows.length - 1];
  return {
    fraction,
    range: activeCalibratedRange(latestRow),
    epochLabel: calibEpochLabel(latestRow.calib_epoch),
  };
}

function formatCalibRange(range: { tempMin: number; tempMax: number; humidityMin: number; humidityMax: number }): string {
  return `${range.tempMin.toFixed(1)}–${range.tempMax.toFixed(1)}°C / ${range.humidityMin.toFixed(
    1
  )}–${range.humidityMax.toFixed(1)}% RH`;
}

export function tempCorrelations(rows: Reading[]): TempCorrelation[] {
  const temps = rows.map((r) => r.temp_c);
  const caveatInfo = calibrationCaveatInfo(rows);
  const outsideCalibratedFraction = caveatInfo?.fraction ?? 0;

  const rangeCaveat = caveatInfo
    ? ` Note: ${Math.round(
        caveatInfo.fraction * 100
      )}% of this window had temp/humidity outside the range observed during ${
        caveatInfo.epochLabel
      } (${formatCalibRange(
        caveatInfo.range
      )}) — treat this correlation with reduced confidence outside that band.`
    : "";

  // CALIBRATE mode only re-fits the zero-point intercept, never the
  // temperature/humidity SLOPE (deliberately — a single short session can't
  // trustworthy re-estimate a slope). So persistent correlation right after
  // a genuine CALIBRATE run (not the lab-fit default) is a meaningful,
  // different signal from persistent correlation against the original
  // fit: it means the slope itself doesn't match this room/chamber's actual
  // thermal behavior, which intercept-only recalibration cannot fix — only
  // a full baseline re-derivation (longer, stable-conditions capture) would.
  const latestEpoch = rows.length ? rows[rows.length - 1].calib_epoch : "";
  const hasRealCalibration = !!latestEpoch && !latestEpoch.startsWith("lab-fit-");
  const slopeCaveat = hasRealCalibration
    ? ` CALIBRATE mode only refits the zero-point (intercept), not how strongly this channel responds to temperature (the slope) — persistent correlation after a real calibration means the slope itself may not match current conditions, which needs a full baseline re-derivation, not another quick recalibration.`
    : "";

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
      )}) — compensation is working.${rangeCaveat}`;
    } else if (absr < CORRELATION.amberBelow) {
      level = "amber";
      note = `${ch.label} shows residual temperature coupling (r=${r.toFixed(
        2
      )}) — watch for compensation drift.${rangeCaveat}${slopeCaveat}`;
    } else {
      level = "red";
      note = `${ch.label} still temperature-correlated after compensation (r=${r.toFixed(
        2
      )}) — compensation may need refitting for current conditions.${rangeCaveat}${slopeCaveat}`;
    }
    return {
      channelId: ch.id,
      label: ch.label,
      comp: ch.comp,
      r,
      level,
      note,
      samples,
      outsideCalibratedFraction,
    };
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

/** A timestamp where ALL FOUR MQ channels jumped at once — the signature of
 *  the known recurring electrical/timing glitch, not 4 independent events. */
export interface GlitchHit {
  ts: number;
  deltas: { channelId: string; label: string; delta: number }[];
}

export interface SpikeDetectionResult {
  spikes: SpikeHit[];
  glitches: GlitchHit[];
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
 * median |Δ| for that channel — AND clears the channel's own measured noise
 * floor (× NOISE_FLOOR_GATE), so a quiet stretch with a tiny rolling median
 * can't make a sub-noise wiggle look like "5x the median" and get flagged.
 * Rows the firmware already caught (spike_flag=1) are excluded — this is the
 * net for anything NEW/uncaught.
 *
 * Candidates that land on the SAME timestamp across all four channels are
 * the known recurring electrical/timing glitch (confirmed from baseline
 * testing: all four jump together every ~5min, independent of gas/temp) —
 * those are split out as `glitches`, not reported as four separate
 * "uncaught spikes", even if spike_flag happened to be 0 for that row.
 */
export function detectSpikes(rows: Reading[]): SpikeDetectionResult {
  if (rows.length < 3) return { spikes: [], glitches: [] };

  const candidates: SpikeHit[] = [];
  for (const ch of MQ_CHANNELS) {
    const series = rows.map((r) => r[ch.comp]);
    const deltas: number[] = series.map((v, i) =>
      i === 0 ? 0 : Math.abs(v - series[i - 1])
    );
    const floor = NOISE_FLOOR_V[ch.id] * NOISE_FLOOR_GATE;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].spike_flag === 1) continue; // firmware already handled it
      if (deltas[i] <= floor) continue; // within the channel's own noise floor — not a candidate
      const med = rollingMedian(deltas, i, SPIKE.window);
      if (!Number.isFinite(med) || med <= 1e-6) continue;
      const ratio = deltas[i] / med;
      if (ratio > SPIKE.factor) {
        candidates.push({
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

  const byTs = new Map<number, SpikeHit[]>();
  for (const c of candidates) {
    const list = byTs.get(c.ts) ?? [];
    list.push(c);
    byTs.set(c.ts, list);
  }

  const spikes: SpikeHit[] = [];
  const glitches: GlitchHit[] = [];
  for (const [ts, group] of byTs) {
    const distinctChannels = new Set(group.map((g) => g.channelId)).size;
    if (distinctChannels === MQ_CHANNELS.length) {
      glitches.push({
        ts,
        deltas: group.map((g) => ({
          channelId: g.channelId,
          label: g.label,
          delta: g.delta,
        })),
      });
    } else {
      spikes.push(...group);
    }
  }

  return {
    spikes: spikes.sort((a, b) => b.ts - a.ts),
    glitches: glitches.sort((a, b) => b.ts - a.ts),
  };
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
  // A ratio breach this check flags as "possible single-sensor fault" can
  // also be produced by BOTH siblings drifting together under heavy
  // calibration extrapolation (their individual a/b/c coefficients respond
  // differently to the same out-of-range conditions) — not just by one
  // sensor actually failing. This check alone can't tell those apart (it's a
  // simple ratio threshold, deliberately simpler than classifyDisturbances'
  // asymmetry-aware sensor-fault check below), so when conditions are mostly
  // outside the calibrated range, say so rather than implying confidence the
  // check doesn't have.
  const caveatInfo = calibrationCaveatInfo(rows);
  const pairCaveat = caveatInfo
    ? ` Note: ${Math.round(
        caveatInfo.fraction * 100
      )}% of this window was outside the range observed during ${
        caveatInfo.epochLabel
      } (${formatCalibRange(
        caveatInfo.range
      )}) — this divergence may reflect unvalidated compensation extrapolation rather than a real hardware fault.`
    : "";

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
      )}) — monitor for a developing fault.${pairCaveat}`;
    } else {
      level = "red";
      note = `${pairLabel} pair ratio ${ratio.toFixed(
        2
      )} is outside its established range — possible single-sensor fault.${pairCaveat}`;
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

/** Least-squares slope of y over index (per-sample). Non-finite values (e.g.
 *  blank temp_c on a calibrating-mode status ping) are filtered out first —
 *  a single NaN in a raw sum poisons the whole result via JS NaN propagation,
 *  which previously made this silently return NaN (and every threshold
 *  check against it silently evaluate to false) whenever a calibrating row
 *  fell inside the window, rather than actually computing the real trend
 *  from the valid samples. */
function slope(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  const n = finite.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  let ym = 0;
  for (const v of finite) ym += v;
  ym /= n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (finite[i] - ym);
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
  // Compares small AVERAGED windows at each edge (not single endpoint
  // samples) specifically so a single-cycle coincident glitch landing on the
  // first or last row can't masquerade as a sustained divergence. Filters
  // non-finite values first (e.g. a calibrating-mode status ping has blank
  // comp columns) — same NaN-propagation hazard as slope() above: a single
  // NaN in the slice would otherwise silently poison aChange/bChange/sep
  // into NaN, making every threshold check against them silently false.
  const edgeAvg = (arr: number[], n: number, fromStart: boolean) => {
    const slice = (fromStart ? arr.slice(0, n) : arr.slice(-n)).filter(Number.isFinite);
    return slice.length ? slice.reduce((a, v) => a + v, 0) / slice.length : NaN;
  };
  for (const { sensor, gasName, a, b } of SENSOR_PAIRS) {
    const w = tail(30);
    const edge = Math.max(1, Math.min(3, Math.floor(w.length / 2)));
    const sa = w.map((r) => r[a.comp]);
    const sb = w.map((r) => r[b.comp]);
    const aStart = edgeAvg(sa, edge, true);
    const aEnd = edgeAvg(sa, edge, false);
    const bStart = edgeAvg(sb, edge, true);
    const bEnd = edgeAvg(sb, edge, false);
    const aChange = Math.abs(aEnd - aStart);
    const bChange = Math.abs(bEnd - bStart);
    const sep = Math.abs(aEnd - bEnd - (aStart - bStart));
    const moverChange = Math.max(aChange, bChange);
    const stayChange = Math.min(aChange, bChange);
    // One sibling moved meaningfully, the separation grew, the other held.
    if (sep > 0.08 && moverChange > 3 * (stayChange + 1e-3) && moverChange > 0.08) {
      const mover = aChange >= bChange ? a : b;
      const faultCaveatInfo = calibrationCaveatInfo(w);
      const faultCaveat = faultCaveatInfo
        ? ` Note: ${Math.round(
            faultCaveatInfo.fraction * 100
          )}% of this window was outside the range observed during ${
            faultCaveatInfo.epochLabel
          } (${formatCalibRange(
            faultCaveatInfo.range
          )}) — confirm this isn't unvalidated compensation extrapolation before assuming hardware failure.`
        : "";
      out.push({
        kind: "sensor-fault",
        level: "red",
        title: "Possible sensor fault",
        detail: `${mover.label} is diverging from its sibling on the ${gasName} (${sensor}) pair while the other reads normally — this pattern suggests hardware failure rather than environment. Investigate the sensor.${faultCaveat}`,
      });
    }
  }

  // ── (b) Draft / door / breath: fast CO2 + an MQ raw channel co-rise, no
  // temp trend. Requires the raw rise to be ASYMMETRIC (some but not all 4
  // channels) — a genuine localized disturbance doesn't move every sensor in
  // lockstep the way the known recurring all-channel timing glitch does, so
  // requiring asymmetry keeps this from mistaking that glitch for a draft. ──
  {
    const w = tail(10);
    const co2 = w.map((r) => r.co2_ppm);
    const temp = w.map((r) => r.temp_c);
    const co2Rise = normalizedRange(co2);
    const tempSlopePerMin = (slope(temp) * 60_000) / stepMs; // °C per minute
    const rawRiseCount = MQ_CHANNELS.filter(
      (ch) => normalizedRange(w.map((r) => r[ch.raw])) > 0.04
    ).length;
    const localized = rawRiseCount >= 1 && rawRiseCount < MQ_CHANNELS.length;
    if (co2Rise > 0.12 && localized && Math.abs(tempSlopePerMin) < 0.05) {
      out.push({
        kind: "draft",
        level: "amber",
        title: "Possible disturbance (draft / door / breath near sensor)",
        detail: `A fast co-rise in CO₂ and ${rawRiseCount} of ${MQ_CHANNELS.length} raw MQ channels, with no matching temperature trend — typical of someone opening a door or breathing near the sensor. Informational only: not a fault, and not a gas trend.`,
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
