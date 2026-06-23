import { config } from "./config.js";
import { COLUMNS, NUMERIC_COLUMNS, Reading } from "./types.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * Parse a timestamp cell into epoch milliseconds. The ESP32/Apps Script pair
 * may write one of several formats, so we handle the common ones rather than
 * assume. Returns NaN if unparseable (the row is then skipped).
 *
 * Naive (no-zone) strings and the Sheets serial-date format are both written
 * in the SPREADSHEET's timezone (config.sheetTzOffsetMin), never the
 * timezone of whatever machine happens to be running this code — building
 * them with `new Date(y, mo, d, ...)` would silently use the host process's
 * local zone instead, which breaks the moment this runs somewhere other than
 * the original dev machine's timezone (confirmed: Render's containers run
 * UTC, which shifted every row 8h into the future).
 */
export function parseTimestamp(value: unknown): number {
  if (value == null || value === "") return NaN;
  const tzOffsetMs = config.sheetTzOffsetMin * 60_000;

  if (typeof value === "number") {
    // Heuristics for numeric timestamps:
    //   - > 1e12  -> already epoch milliseconds (absolute, no zone ambiguity)
    //   - > 1e9   -> epoch seconds (same)
    //   - else    -> Google Sheets serial date (days since 1899-12-30, in
    //                the spreadsheet's timezone)
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
    return SHEETS_EPOCH + value * 86_400_000 - tzOffsetMs;
  }

  const s = String(value).trim();
  // "YYYY-MM-DD HH:mm:ss" (no T, no zone) — spreadsheet-local time.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    const utcMs = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se || "0")
    );
    return utcMs - tzOffsetMs;
  }
  // Fallback for any other format — only reached for strings that don't
  // match the pattern above. If it includes an explicit zone (e.g. a "Z" or
  // "+08:00" suffix), Date.parse handles it correctly on its own; if it
  // doesn't, this has the same host-timezone risk as above, but that's the
  // best a generic parse can do for a format we don't otherwise recognize.
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function toNumber(value: unknown): number {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isNaN(n) ? NaN : n;
}

async function fetchValues(range: string): Promise<unknown[][]> {
  const url =
    `${SHEETS_BASE}/${config.sheetId}/values/${encodeURIComponent(range)}` +
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
  return json.values ?? [];
}

/** Fetch just the header row, so a column reorder is still caught without
 *  paying to re-fetch the (potentially huge, ever-growing) data rows. */
export async function fetchHeader(): Promise<string[]> {
  const values = await fetchValues(`${config.sheetRange}!1:1`);
  return (values[0] ?? []).map((h) => String(h).trim());
}

/** Turn raw data rows (no header row included) into typed Readings, given an
 *  already-fetched header for the name→index map. Rows with an unparseable
 *  timestamp are dropped. */
function parseDataRows(values: unknown[][], header: string[]): Reading[] {
  const idx: Record<string, number> = {};
  header.forEach((name, i) => {
    idx[name] = i;
  });

  const missing = COLUMNS.filter((c) => !(c in idx));
  if (missing.length) {
    console.warn(
      `[sheets] header is missing expected columns: ${missing.join(", ")}`
    );
  }

  const readings: Reading[] = [];
  for (const row of values) {
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

export interface DataRowsResult {
  readings: Reading[];
  /** Raw row count consumed from the range, BEFORE dropping any rows with an
   *  unparseable timestamp. The caller must advance its row cursor by this,
   *  not by readings.length — otherwise a single bad row would desync the
   *  cursor from the sheet's real row numbers and we'd keep re-requesting
   *  the same range forever. */
  rawRowCount: number;
}

/**
 * Fetch data rows starting at 1-indexed data-row number `fromDataRow` (1 = the
 * first row after the header — pass 1 to pull the whole sheet). Used
 * incrementally: the store tracks how many data rows it has already
 * ingested and only asks for what's new, so a poll cycle's cost stays
 * roughly constant (one new row) instead of growing with the sheet forever.
 */
export async function fetchDataRows(
  header: string[],
  fromDataRow = 1
): Promise<DataRowsResult> {
  const startSheetRow = fromDataRow + 1; // +1 to skip the header row
  const values = await fetchValues(`${config.sheetRange}!A${startSheetRow}:M`);
  return { readings: parseDataRows(values, header), rawRowCount: values.length };
}
