import { BASELINE } from "./constants";

export interface BaselinePoint {
  ts: number;
  value: number;
}

export interface BaselineResult {
  available: boolean;
  /** Mean value of the detected plateau, in the SAME unit as the input series
   *  (volts for MQ comp channels, ppm for CO2). Unit conversion happens at
   *  the display layer, same as everywhere else in the app. */
  baselineValue: number;
  baselineStartTs: number;
  baselineEndTs: number;
  stableDurationMs: number;
  /** True when the live tail itself IS the qualifying plateau — i.e. nothing
   *  has moved, the channel is currently sitting at its own control level. */
  isAtBaseline: boolean;
  /** Median |Δ| between consecutive samples — the channel's own noise floor. */
  noiseFloor: number;
}

const UNAVAILABLE: BaselineResult = {
  available: false,
  baselineValue: NaN,
  baselineStartTs: NaN,
  baselineEndTs: NaN,
  stableDurationMs: 0,
  isAtBaseline: false,
  noiseFloor: NaN,
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Finds the most recent sustained "control" plateau in a value series and
 * reports it as the current baseline.
 *
 * There's no fixed reference value — instead this scans backward from the
 * newest sample, growing a window as long as its spread stays inside a
 * noise-adaptive band. The first (i.e. most recent) window that reaches
 * `minStableMs` becomes the baseline:
 *
 *  - If the live tail itself is flat enough, the baseline IS the live value
 *    (the channel is currently "at control", `isAtBaseline: true`).
 *  - If the live tail is mid-excursion (rising/falling), the scan skips back
 *    past it to the last plateau that DID hold — that's the reference point
 *    the live value is now being compared against.
 *
 * The moment a new level holds flat for `minStableMs`, it becomes the
 * baseline on its own — this is what lets it "adapt" to a controlled
 * environment that differs across deployments rather than assuming a fixed
 * constant from first boot.
 */
export function computeBaseline(points: BaselinePoint[]): BaselineResult {
  const pts = points.filter((p) => Number.isFinite(p.value));
  if (pts.length < BASELINE.minSamples) return UNAVAILABLE;

  const deltas: number[] = [];
  for (let i = 1; i < pts.length; i++) deltas.push(Math.abs(pts[i].value - pts[i - 1].value));
  const noiseFloor = Math.max(median(deltas), 1e-6);
  const band = noiseFloor * BASELINE.stableBandFactor;

  // For each right edge i (scanned newest → oldest), grow the window left as
  // far as the [min,max] spread stays within `band`. Return on the first i
  // whose maximal stable window is long enough — that's the most recent
  // qualifying plateau, by construction.
  for (let i = pts.length - 1; i >= 0; i--) {
    let lo = i;
    let mn = pts[i].value;
    let mx = pts[i].value;
    while (lo > 0) {
      const v = pts[lo - 1].value;
      const nmn = Math.min(mn, v);
      const nmx = Math.max(mx, v);
      if (nmx - nmn > band) break;
      mn = nmn;
      mx = nmx;
      lo--;
    }
    const spanMs = pts[i].ts - pts[lo].ts;
    if (spanMs >= BASELINE.minStableMs) {
      const window = pts.slice(lo, i + 1);
      const baselineValue = window.reduce((a, p) => a + p.value, 0) / window.length;
      return {
        available: true,
        baselineValue,
        baselineStartTs: pts[lo].ts,
        baselineEndTs: pts[i].ts,
        stableDurationMs: spanMs,
        isAtBaseline: i === pts.length - 1,
        noiseFloor,
      };
    }
  }
  return { ...UNAVAILABLE, noiseFloor };
}
