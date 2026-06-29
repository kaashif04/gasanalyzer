// Mirror of the backend Reading shape. Kept in sync by hand — the backend
// addresses sheet columns by name, so this is the canonical client view.
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
  /** 1 on the first row logged after a fresh firmware boot, 0 otherwise.
   *  NaN if the column doesn't exist in the sheet yet (treat as "unknown",
   *  same as any other missing optional column here). */
  session_start: number;
  /** Identifier of whichever compensation calibration was active when this
   *  row was logged. "" if the column doesn't exist in the sheet yet. */
  calib_epoch: string;
  /** Observed temp/RH range during that calibration run — the range
   *  compensation is actually validated across for THIS row. NaN if not yet
   *  available. */
  calib_temp_min_c: number;
  calib_temp_max_c: number;
  calib_hum_min_pct: number;
  calib_hum_max_pct: number;
}

export interface LatestResponse {
  reading: Reading | null;
  ageMs: number | null;
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

export type Unit = "voltage" | "ppm" | "percent";

export type StatusLevel = "nominal" | "drift" | "fault" | "stale";

// Field keys for the four MQ channels' compensated and raw columns.
export type CompKey =
  | "mq4_1_comp"
  | "mq4_2_comp"
  | "mq8_1_comp"
  | "mq8_2_comp";
export type RawKey = "mq4_1_raw" | "mq4_2_raw" | "mq8_1_raw" | "mq8_2_raw";

export type MqSensorType = "MQ-4" | "MQ-8";
