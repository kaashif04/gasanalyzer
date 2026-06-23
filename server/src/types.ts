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
] as const;

export type ColumnName = (typeof COLUMNS)[number];

/** Numeric sensor columns (everything except timestamp). */
export const NUMERIC_COLUMNS = COLUMNS.filter(
  (c) => c !== "timestamp"
) as Exclude<ColumnName, "timestamp">[];

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
