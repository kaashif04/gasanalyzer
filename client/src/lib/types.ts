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
