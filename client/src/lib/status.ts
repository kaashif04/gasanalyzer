import { CALIBRATED_RANGE, CO2_PPM, HUMIDITY_PCT, MQ_VOLTAGE, TEMP_C } from "./constants";
import { StatusLevel } from "./types";

/** Visual treatment for each status level. Color is always paired with an
 *  icon/shape elsewhere in the UI so it never relies on hue alone. */
export const STATUS_META: Record<
  StatusLevel,
  { label: string; color: string; text: string; ring: string; glyph: string }
> = {
  nominal: {
    label: "Nominal",
    color: "#34d399",
    text: "text-nominal",
    ring: "ring-nominal/40",
    glyph: "●",
  },
  drift: {
    label: "Drifting",
    color: "#fbbf24",
    text: "text-drift",
    ring: "ring-drift/40",
    glyph: "▲",
  },
  fault: {
    label: "Fault / out of range",
    color: "#fb5d6b",
    text: "text-fault",
    ring: "ring-fault/40",
    glyph: "■",
  },
  stale: {
    label: "Stale / offline",
    color: "#94a3b8",
    text: "text-slate-400",
    ring: "ring-slate-500/40",
    glyph: "◌",
  },
};

/** MQ status from the compensated voltage against the operating envelope. */
export function mqStatus(volts: number): StatusLevel {
  if (!Number.isFinite(volts)) return "fault";
  const { min, max, nearBand } = MQ_VOLTAGE;
  if (volts < min || volts > max) return "fault";
  if (volts < min + nearBand || volts > max - nearBand) return "drift";
  return "nominal";
}

export function co2Status(ppm: number): StatusLevel {
  if (!Number.isFinite(ppm)) return "fault";
  if (ppm < CO2_PPM.min || ppm > CO2_PPM.max) return "fault";
  if (ppm > CO2_PPM.amber) return "drift";
  return "nominal";
}

export function tempStatus(c: number): StatusLevel {
  if (!Number.isFinite(c)) return "fault";
  if (c < TEMP_C.min || c > TEMP_C.max) return "fault";
  if (c > TEMP_C.amber) return "drift";
  return "nominal";
}

export function humidityStatus(pct: number): StatusLevel {
  if (!Number.isFinite(pct)) return "fault";
  if (pct < HUMIDITY_PCT.min || pct > HUMIDITY_PCT.max) return "fault";
  if (pct > HUMIDITY_PCT.amber) return "drift";
  return "nominal";
}

/** Whether temp/humidity are inside the envelope the compensation formula was
 *  actually fit across. Outside this range, *_comp accuracy is unvalidated —
 *  callers should show a caveat rather than treat comp output with full
 *  confidence. */
export function isWithinCalibratedRange(temp_c: number, humidity_pct: number): boolean {
  return (
    temp_c >= CALIBRATED_RANGE.tempMin &&
    temp_c <= CALIBRATED_RANGE.tempMax &&
    humidity_pct >= CALIBRATED_RANGE.humidityMin &&
    humidity_pct <= CALIBRATED_RANGE.humidityMax
  );
}
