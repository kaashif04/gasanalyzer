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
  useMock: explicitMock || missingCreds,
  mockReason: explicitMock
    ? "USE_MOCK=true"
    : missingCreds
    ? "SHEET_ID / SHEETS_API_KEY not set"
    : "",
} as const;

export type Config = typeof config;
