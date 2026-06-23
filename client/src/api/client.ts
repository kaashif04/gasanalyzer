import { HistoryResponse, LatestResponse } from "../lib/types";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function fetchLatest(): Promise<LatestResponse> {
  return getJSON<LatestResponse>("/api/latest");
}

export function fetchHistory(
  fromMs: number,
  toMs: number
): Promise<HistoryResponse> {
  return getJSON<HistoryResponse>(
    `/api/history?from=${Math.floor(fromMs)}&to=${Math.floor(toMs)}`
  );
}

/** URL for the CSV export endpoint over a time range. */
export function exportUrl(fromMs: number, toMs: number): string {
  return `/api/export?from=${Math.floor(fromMs)}&to=${Math.floor(toMs)}`;
}
