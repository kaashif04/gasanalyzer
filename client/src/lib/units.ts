import { MqSensorType, Unit } from "./types";

/**
 * ── Unit conversion ─────────────────────────────────────────────────────────
 * IMPORTANT: PPM and Percent for the MQ channels are *datasheet approximations*
 * derived from the sensor voltage — NOT a trained, lab-calibrated gas model.
 * This label MUST travel with any estimated value shown in the UI.
 */
export const ESTIMATED_NOTE =
  "estimated — datasheet approximation, not yet calibrated against lab equipment";

/** Assumed front-end circuit constants for the Rs/Ro computation. */
const VCC = 5.0; // sensor supply (V)
const RL = 10.0; // load resistor (kΩ)

/**
 * Datasheet-fit power-law coefficients for ppm = a · (Rs/Ro)^b, plus the
 * clean-air resistance ratio used to anchor Ro. These come from the typical
 * MQ-4 / MQ-8 sensitivity curves and are intentionally approximate.
 */
const MQ_CURVE: Record<
  MqSensorType,
  { a: number; b: number; cleanAirRatio: number; gas: string }
> = {
  "MQ-4": { a: 1012.7, b: -2.786, cleanAirRatio: 4.4, gas: "CH₄" },
  "MQ-8": { a: 976.97, b: -1.6, cleanAirRatio: 70, gas: "H₂" },
};

/**
 * Convert a sensor voltage to an estimated ppm. Higher voltage across the load
 * ⇒ lower Rs ⇒ more gas. Clamped to keep the math well-behaved at the rails.
 */
export function voltageToPpm(volts: number, sensor: MqSensorType): number {
  if (!Number.isFinite(volts)) return NaN;
  const v = Math.min(Math.max(volts, 0.05), VCC - 0.05);
  const rs = ((VCC - v) / v) * RL;
  const { a, b, cleanAirRatio } = MQ_CURVE[sensor];
  // Ro is the clean-air resistance; approximate it from the assumed clean-air
  // ratio so the curve is anchored without a per-unit calibration.
  const ro = RL * cleanAirRatio;
  const ratio = rs / ro;
  const ppm = a * Math.pow(ratio, b);
  return Number.isFinite(ppm) ? Math.max(ppm, 0) : NaN;
}

/** Convert an MQ voltage into the requested display unit. */
export function convertMq(
  volts: number,
  sensor: MqSensorType,
  unit: Unit
): number {
  if (unit === "voltage") return volts;
  const ppm = voltageToPpm(volts, sensor);
  if (unit === "ppm") return ppm;
  return ppm / 10_000; // percent: 1% = 10,000 ppm
}

/** Whether the current unit produces an *estimated* MQ value (needs the note). */
export function isEstimatedUnit(unit: Unit): boolean {
  return unit !== "voltage";
}

export const UNIT_META: Record<
  Unit,
  { label: string; abbr: string; mqSuffix: string }
> = {
  voltage: { label: "Voltage", abbr: "V", mqSuffix: "V" },
  ppm: { label: "PPM", abbr: "ppm", mqSuffix: "ppm" },
  percent: { label: "Percent", abbr: "%", mqSuffix: "%" },
};

/** Decimal places to show for an MQ value in a given unit. */
export function mqPrecision(unit: Unit): number {
  if (unit === "voltage") return 3;
  if (unit === "percent") return 4;
  return 0; // ppm
}

// ── CO₂ (native ppm, optional percent) ──
export type Co2Unit = "ppm" | "percent";
export function convertCo2(ppm: number, unit: Co2Unit): number {
  return unit === "percent" ? ppm / 10_000 : ppm;
}
