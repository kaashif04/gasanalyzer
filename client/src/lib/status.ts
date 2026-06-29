import { CALIBRATED_RANGE, CO2_PPM, HUMIDITY_PCT, MQ_VOLTAGE, TEMP_C } from "./constants";
import { Reading, StatusLevel } from "./types";

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

export interface CalibRange {
  tempMin: number;
  tempMax: number;
  humidityMin: number;
  humidityMax: number;
}

/**
 * Which temp/RH band a given row's compensation was actually validated
 * across. Each row carries its own calib_temp_min_c/calib_temp_max_c/
 * calib_hum_min_pct/calib_hum_max_pct (the observed range during whichever
 * CALIBRATE run was active when it was logged) — this reads that, per row,
 * so the check stays correct across a recalibration instead of checking
 * every row against one fixed-forever band. Falls back to CALIBRATED_RANGE
 * (the original lab fit) for rows from before the firmware sent this
 * metadata, or if any of the four fields is missing/NaN.
 */
export function activeCalibratedRange(reading: Reading | null | undefined): CalibRange {
  if (
    reading &&
    Number.isFinite(reading.calib_temp_min_c) &&
    Number.isFinite(reading.calib_temp_max_c) &&
    Number.isFinite(reading.calib_hum_min_pct) &&
    Number.isFinite(reading.calib_hum_max_pct)
  ) {
    return {
      tempMin: reading.calib_temp_min_c,
      tempMax: reading.calib_temp_max_c,
      humidityMin: reading.calib_hum_min_pct,
      humidityMax: reading.calib_hum_max_pct,
    };
  }
  return CALIBRATED_RANGE;
}

/** Whether temp/humidity are inside the envelope the compensation formula was
 *  actually fit across. Outside this range, *_comp accuracy is unvalidated —
 *  callers should show a caveat rather than treat comp output with full
 *  confidence. Pass the row's own `activeCalibratedRange()` result, not the
 *  raw CALIBRATED_RANGE constant, so this stays correct across a
 *  recalibration. */
export function isWithinCalibratedRange(
  temp_c: number,
  humidity_pct: number,
  range: CalibRange = CALIBRATED_RANGE
): boolean {
  return (
    temp_c >= range.tempMin &&
    temp_c <= range.tempMax &&
    humidity_pct >= range.humidityMin &&
    humidity_pct <= range.humidityMax
  );
}
