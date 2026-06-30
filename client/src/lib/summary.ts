import type { Reading } from "./types";

/** The last N minutes of a time range is used as the "final" window — what the
 *  readings settled to after introducing gas (or at the end of a session). */
export const SUMMARY_FINAL_WINDOW_MS = 5 * 60_000;

export interface ChannelSummary {
  key: string;
  label: string;
  unit: string;
  /** Mean over the control phase (before gas introduction, or first 10% if no
   *  marker is set). The researcher's "baseline" number for regression. */
  control: number;
  /** Mean over the last SUMMARY_FINAL_WINDOW_MS of the selected range — where
   *  the sensors settled to after gas exposure. The "final reading" to compare
   *  against the reference instrument. */
  final: number;
  /** final − control */
  delta: number;
  min: number;
  max: number;
  /** Mean over the ENTIRE selected range. */
  mean: number;
  /** Number of valid (non-NaN) samples used in the whole-range stats. */
  n: number;
}

export interface RunSummary {
  channels: ChannelSummary[];
  rangeStart: number;
  rangeEnd: number;
  /** When the control phase ends (= gas-introduction marker, or rangeStart +
   *  10% of total duration if no marker was set). */
  controlEnd: number;
  /** When the "final" averaging window begins (= rangeEnd − SUMMARY_FINAL_WINDOW_MS). */
  finalWindowStart: number;
  sampleCount: number;
  /** The calibration epoch active for the majority of this run (from the latest
   *  row's calib_epoch), for traceability alongside the regression dataset. */
  calibEpoch: string;
}

/** All the channels that matter for researcher comparison, in display order. */
const CHANNELS: {
  key: string;
  label: string;
  unit: string;
  pick: (r: Reading) => number;
}[] = [
  { key: "mq4_1_comp", label: "Methane #1 (compensated)", unit: "V",   pick: (r) => r.mq4_1_comp },
  { key: "mq4_1_raw",  label: "Methane #1 (raw)",         unit: "V",   pick: (r) => r.mq4_1_raw  },
  { key: "mq4_2_comp", label: "Methane #2 (compensated)", unit: "V",   pick: (r) => r.mq4_2_comp },
  { key: "mq4_2_raw",  label: "Methane #2 (raw)",         unit: "V",   pick: (r) => r.mq4_2_raw  },
  { key: "mq8_1_comp", label: "Hydrogen #1 (compensated)", unit: "V",  pick: (r) => r.mq8_1_comp },
  { key: "mq8_1_raw",  label: "Hydrogen #1 (raw)",         unit: "V",  pick: (r) => r.mq8_1_raw  },
  { key: "mq8_2_comp", label: "Hydrogen #2 (compensated)", unit: "V",  pick: (r) => r.mq8_2_comp },
  { key: "mq8_2_raw",  label: "Hydrogen #2 (raw)",         unit: "V",  pick: (r) => r.mq8_2_raw  },
  { key: "co2_ppm",    label: "CO₂",                       unit: "ppm", pick: (r) => r.co2_ppm   },
  { key: "temp_c",     label: "Temperature",               unit: "°C",  pick: (r) => r.temp_c    },
  { key: "humidity_pct", label: "Humidity",                unit: "%RH", pick: (r) => r.humidity_pct },
];

function finiteVals(rows: Reading[], pick: (r: Reading) => number): number[] {
  return rows.map(pick).filter(Number.isFinite);
}
function mean(vals: number[]): number {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

/**
 * Computes the control-vs-final run summary from a sorted, continuous
 * set of readings. The `gasIntroducedAt` marker, when provided, splits the
 * range into a control phase and a gas-exposure phase — without it, the first
 * 10% of the range is treated as the control baseline. The "final" reading is
 * always the mean of the last SUMMARY_FINAL_WINDOW_MS of the whole range.
 *
 * Returns null if `rows` is empty.
 */
export function computeRunSummary(
  rows: Reading[],
  gasIntroducedAt: number | null
): RunSummary | null {
  if (!rows.length) return null;

  const rangeStart = rows[0].ts;
  const rangeEnd = rows[rows.length - 1].ts;
  const totalMs = Math.max(rangeEnd - rangeStart, 1);

  const controlEnd =
    gasIntroducedAt != null
      ? Math.max(rangeStart, Math.min(gasIntroducedAt, rangeEnd))
      : rangeStart + totalMs * 0.1;

  const finalWindowStart = Math.max(rangeStart, rangeEnd - SUMMARY_FINAL_WINDOW_MS);

  const controlRows = rows.filter((r) => r.ts <= controlEnd);
  const finalRows = rows.filter((r) => r.ts >= finalWindowStart);

  const channels: ChannelSummary[] = CHANNELS.map(({ key, label, unit, pick }) => {
    const allVals = finiteVals(rows, pick);
    const controlVal = mean(finiteVals(controlRows, pick));
    const finalVal = mean(finiteVals(finalRows, pick));
    return {
      key,
      label,
      unit,
      control: controlVal,
      final: finalVal,
      delta: finalVal - controlVal,
      min: allVals.length ? Math.min(...allVals) : NaN,
      max: allVals.length ? Math.max(...allVals) : NaN,
      mean: mean(allVals),
      n: allVals.length,
    };
  });

  return {
    channels,
    rangeStart,
    rangeEnd,
    controlEnd,
    finalWindowStart,
    sampleCount: rows.length,
    calibEpoch: rows[rows.length - 1]?.calib_epoch ?? "",
  };
}

/** Generates a CSV string from a RunSummary for download. */
export function summaryToCsv(s: RunSummary): string {
  const header =
    "channel,unit,control_mean,final_mean,delta,min,max,whole_range_mean,n_samples";
  const lines = s.channels.map((c) =>
    [
      JSON.stringify(c.label),
      c.unit,
      Number.isFinite(c.control) ? c.control.toFixed(4) : "",
      Number.isFinite(c.final) ? c.final.toFixed(4) : "",
      Number.isFinite(c.delta) ? c.delta.toFixed(4) : "",
      Number.isFinite(c.min) ? c.min.toFixed(4) : "",
      Number.isFinite(c.max) ? c.max.toFixed(4) : "",
      Number.isFinite(c.mean) ? c.mean.toFixed(4) : "",
      c.n,
    ].join(",")
  );
  const meta = [
    `# Biogas Monitor — Run Summary`,
    `# Range: ${new Date(s.rangeStart).toISOString()} – ${new Date(s.rangeEnd).toISOString()}`,
    `# Control phase ends: ${new Date(s.controlEnd).toISOString()}`,
    `# Final window starts: ${new Date(s.finalWindowStart).toISOString()} (last 5 min)`,
    `# Calibration active: ${s.calibEpoch || "unknown"}`,
    `# Samples in range: ${s.sampleCount}`,
    `#`,
  ];
  return [...meta, header, ...lines].join("\n");
}
