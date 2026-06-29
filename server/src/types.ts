/**
 * The exact, confirmed schema of the "Data" tab. These are the only columns
 * we expect. Everything downstream addresses columns BY NAME (never by index)
 * so a future reorder in the sheet can't silently corrupt parsing.
 */
export const COLUMNS = [
  "timestamp",
  "mq4_1_raw",
  "mq4_2_raw",
  "mq8_1_raw",
  "mq8_2_raw",
  "mq4_1_comp",
  "mq4_2_comp",
  "mq8_1_comp",
  "mq8_2_comp",
  "co2_ppm",
  "temp_c",
  "humidity_pct",
  "spike_flag",
  // New as of the session_start / CALIBRATE-mode firmware update — may be
  // absent on older rows, or until firmware + the Apps Script webhook are
  // both updated. Missing values parse to NaN/"" like any other optional
  // column here; every consumer treats that as "not yet known", not an error.
  "session_start",
  "calib_epoch",
  "calib_temp_min_c",
  "calib_temp_max_c",
  "calib_hum_min_pct",
  "calib_hum_max_pct",
] as const;

export type ColumnName = (typeof COLUMNS)[number];

/** Columns that are text, not numeric. */
const STRING_COLUMNS = ["timestamp", "calib_epoch"] as const;

/** Numeric sensor columns (everything except the string columns). */
export const NUMERIC_COLUMNS = COLUMNS.filter(
  (c) => !(STRING_COLUMNS as readonly string[]).includes(c)
) as Exclude<ColumnName, (typeof STRING_COLUMNS)[number]>[];

/**
 * A single parsed reading. `timestamp` is normalized to epoch milliseconds
 * (`ts`) plus the original string (`timestamp`) so the client can display the
 * lab's local formatting if it wants. `spike_flag` is a 0/1 boolean-ish number.
 */
export interface Reading {
  ts: number;
  timestamp: string;
  mq4_1_raw: number;
  mq4_2_raw: number;
  mq8_1_raw: number;
  mq8_2_raw: number;
  mq4_1_comp: number;
  mq4_2_comp: number;
  mq8_1_comp: number;
  mq8_2_comp: number;
  co2_ppm: number;
  temp_c: number;
  humidity_pct: number;
  spike_flag: number;
  /** 1 on the first row logged after a fresh firmware boot, 0 otherwise —
   *  lets the dashboard tell "was powered off" apart from "silently dropped
   *  out mid-session". NaN if the column doesn't exist in the sheet yet. */
  session_start: number;
  /** Identifier of whichever temp/humidity-compensation calibration was
   *  active when this row was logged (e.g. "2026-06-23 14:00:00", or
   *  "lab-fit-2026-06-23" for the original baseline) — keeps historical data
   *  traceable to its baseline after a later recalibration. "" if the column
   *  doesn't exist in the sheet yet. */
  calib_epoch: string;
  /** Observed temp/RH range during the calib_epoch calibration run — the
   *  range compensation is actually validated across for THIS row, not a
   *  fixed one-time-forever band. NaN if not yet available. */
  calib_temp_min_c: number;
  calib_temp_max_c: number;
  calib_hum_min_pct: number;
  calib_hum_max_pct: number;
}

export interface LatestResponse {
  reading: Reading | null;
  /** ms since the server last successfully ingested any data. */
  ageMs: number | null;
  /** ms between the latest row's timestamp and now. */
  rowAgeMs: number | null;
  source: "sheet" | "mock";
  pollIntervalMs: number;
  lastPollOk: boolean;
  lastError: string | null;
  totalRows: number;
}

export interface HistoryResponse {
  readings: Reading[];
  source: "sheet" | "mock";
}
