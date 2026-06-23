import { Router, Request, Response } from "express";
import { store } from "./store.js";
import { config } from "./config.js";
import { COLUMNS, Reading } from "./types.js";

export const api = Router();

/** Parse a ?from/?to query value (epoch ms or ISO string) into epoch ms. */
function parseTimeParam(value: unknown, fallback: number): number {
  if (value == null || value === "") return fallback;
  const asNum = Number(value);
  if (!Number.isNaN(asNum) && asNum > 0) return asNum;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
}

api.get("/latest", (_req: Request, res: Response) => {
  const latest = store.latest;
  const now = Date.now();
  res.json({
    reading: latest,
    ageMs: store.lastIngestAt != null ? now - store.lastIngestAt : null,
    rowAgeMs: latest ? now - latest.ts : null,
    source: store.source,
    pollIntervalMs: config.pollIntervalMs,
    lastPollOk: store.lastPollOk,
    lastError: store.lastError,
    totalRows: store.count,
  });
});

api.get("/history", (req: Request, res: Response) => {
  const now = Date.now();
  const from = parseTimeParam(req.query.from, now - 60 * 60 * 1000);
  const to = parseTimeParam(req.query.to, now);
  res.json({ readings: store.range(from, to), source: store.source });
});

/** Quick health/status probe for the frontend connection indicator. */
api.get("/status", (_req: Request, res: Response) => {
  res.json({
    source: store.source,
    mock: config.useMock,
    mockReason: config.mockReason,
    lastPollOk: store.lastPollOk,
    lastError: store.lastError,
    totalRows: store.count,
    pollIntervalMs: config.useMock ? 30_000 : config.pollIntervalMs,
    lastIngestAt: store.lastIngestAt,
  });
});

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

api.get("/export", (req: Request, res: Response) => {
  const now = Date.now();
  const from = parseTimeParam(req.query.from, 0);
  const to = parseTimeParam(req.query.to, now);
  const rows = store.range(from, to);

  // Include raw, comp, and spike_flag — exactly the columns the sheet has,
  // in canonical order, so the export matches IWK's source-of-truth layout.
  const header = COLUMNS.join(",");
  const lines = rows.map((r) =>
    COLUMNS.map((col) => {
      const value = (r as unknown as Record<string, unknown>)[col];
      return csvEscape(value == null ? "" : String(value));
    }).join(",")
  );
  const csv = [header, ...lines].join("\n");

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="biogas_${stamp}.csv"`
  );
  res.send(csv);
});

export type { Reading };
