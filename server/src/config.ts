import dotenv from "dotenv";

dotenv.config();

const SHEET_ID = process.env.SHEET_ID?.trim() || "";
const SHEETS_API_KEY = process.env.SHEETS_API_KEY?.trim() || "";

/**
 * Mock mode is on if explicitly requested, OR if we simply don't have the
 * credentials needed to talk to a real sheet. This lets the whole app run
 * end-to-end on a fresh checkout with zero setup, then switch to live data
 * the moment a .env is filled in.
 */
const explicitMock = (process.env.USE_MOCK || "").toLowerCase() === "true";
const missingCreds = !SHEET_ID || !SHEETS_API_KEY;

export const config = {
  sheetId: SHEET_ID,
  apiKey: SHEETS_API_KEY,
  sheetRange: process.env.SHEET_RANGE?.trim() || "Data",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 30_000,
  port: Number(process.env.PORT) || 4000,
  // Minutes EAST of UTC that the sheet's naive "YYYY-MM-DD HH:mm:ss" timestamp
  // strings are written in (the spreadsheet/Apps Script timezone — not the
  // timezone of whatever machine happens to run this backend). Default 480 =
  // UTC+8. MUST be explicit: parsing a naive datetime string with the host
  // process's local timezone breaks the moment this runs somewhere other
  // than the original dev machine's zone (e.g. Render's containers run UTC),
  // silently shifting every row's timestamp by the zone difference.
  sheetTzOffsetMin: Number(process.env.SHEET_TZ_OFFSET_MIN) || 480,
  useMock: explicitMock || missingCreds,
  mockReason: explicitMock
    ? "USE_MOCK=true"
    : missingCreds
    ? "SHEET_ID / SHEETS_API_KEY not set"
    : "",
} as const;

export type Config = typeof config;
