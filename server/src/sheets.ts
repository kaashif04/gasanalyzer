import { config } from "./config.js";
import { COLUMNS, NUMERIC_COLUMNS, Reading } from "./types.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * Parse a timestamp cell into epoch milliseconds. The ESP32/Apps Script pair
 * may write one of several formats, so we handle the common ones rather than
 * assume. Returns NaN if unparseable (the row is then skipped).
 */
export function parseTimestamp(value: unknown): number {
  if (value == null || value === "") return NaN;

  if (typeof value === "number") {
    // Heuristics for numeric timestamps:
    //   - > 1e12  -> already epoch milliseconds
    //   - > 1e9   -> epoch seconds
    //   - else    -> Google Sheets serial date (days since 1899-12-30)
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
    return SHEETS_EPOCH + value * 86_400_000;
  }

  const s = String(value).trim();
  // "YYYY-MM-DD HH:mm:ss" (no T, no zone) — treat as local time.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se || "0")
    ).getTime();
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function toNumber(value: unknown): number {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isNaN(n) ? NaN : n;
}

/**
 * Turn the raw 2D array from values.get into typed Readings. The first row is
 * treated as the header; we build a name->index map from it so column order in
 * the sheet is irrelevant. Rows with an unparseable timestamp are dropped.
 */
export function parseRows(values: unknown[][]): Reading[] {
  if (!values || values.length < 2) return [];

  const header = values[0].map((h) => String(h).trim());
  const idx: Record<string, number> = {};
  header.forEach((name, i) => {
    idx[name] = i;
  });

  // Verify every expected column is present; warn loudly if not.
  const missing = COLUMNS.filter((c) => !(c in idx));
  if (missing.length) {
    console.warn(
      `[sheets] header is missing expected columns: ${missing.join(", ")}`
    );
  }

  const readings: Reading[] = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row || row.length === 0) continue;

    const ts = parseTimestamp(row[idx["timestamp"]]);
    if (Number.isNaN(ts)) continue;

    const reading: Reading = {
      ts,
      timestamp: String(row[idx["timestamp"]] ?? ""),
    } as Reading;

    for (const col of NUMERIC_COLUMNS) {
      const value = idx[col] != null ? toNumber(row[idx[col]]) : NaN;
      (reading as unknown as Record<string, number>)[col] = value;
    }
    readings.push(reading);
  }

  // Defensive: ensure ascending time order regardless of sheet ordering.
  readings.sort((a, b) => a.ts - b.ts);
  return readings;
}

/**
 * Fetch the entire Data range and return parsed Readings. Uses UNFORMATTED_VALUE
 * so numeric columns arrive as numbers, with datetimes as strings.
 */
export async function fetchReadings(): Promise<Reading[]> {
  const range = encodeURIComponent(config.sheetRange);
  const url =
    `${SHEETS_BASE}/${config.sheetId}/values/${range}` +
    `?valueRenderOption=UNFORMATTED_VALUE` +
    `&dateTimeRenderOption=FORMATTED_STRING` +
    `&key=${config.apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Sheets API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`
    );
  }
  const json = (await res.json()) as { values?: unknown[][] };
  return parseRows(json.values ?? []);
}
