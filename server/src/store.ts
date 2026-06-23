import { config } from "./config.js";
import { fetchReadings } from "./sheets.js";
import { generateHistory, generateOne, MOCK_STEP_MS } from "./mock.js";
import { Reading } from "./types.js";

/**
 * Holds all readings in memory, sorted ascending by time. A week of 30s data is
 * ~20k rows — trivial to keep resident, and it lets /api/history be a fast
 * in-memory filter rather than a per-request round-trip to Google.
 */
class ReadingStore {
  private readings: Reading[] = [];
  private byTs = new Set<number>();

  lastPollOk = false;
  lastError: string | null = null;
  /** When we last successfully ingested ANY data (epoch ms). */
  lastIngestAt: number | null = null;

  get source(): "sheet" | "mock" {
    return config.useMock ? "mock" : "sheet";
  }

  get all(): Reading[] {
    return this.readings;
  }

  get latest(): Reading | null {
    return this.readings.length ? this.readings[this.readings.length - 1] : null;
  }

  get count(): number {
    return this.readings.length;
  }

  range(fromMs: number, toMs: number): Reading[] {
    return this.readings.filter((r) => r.ts >= fromMs && r.ts <= toMs);
  }

  /** Merge fresh readings, de-duplicating on timestamp. */
  private merge(incoming: Reading[]): number {
    let added = 0;
    for (const r of incoming) {
      if (this.byTs.has(r.ts)) continue;
      this.byTs.add(r.ts);
      this.readings.push(r);
      added++;
    }
    if (added) {
      this.readings.sort((a, b) => a.ts - b.ts);
      this.lastIngestAt = Date.now();
    }
    return added;
  }

  private async pollSheet(): Promise<void> {
    try {
      const rows = await fetchReadings();
      // Re-fetching the whole sheet each cycle; merge keeps it idempotent.
      this.byTs.clear();
      this.readings = [];
      this.merge(rows);
      this.lastPollOk = true;
      this.lastError = null;
      if (rows.length) this.lastIngestAt = Date.now();
    } catch (err) {
      this.lastPollOk = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[poll] sheet fetch failed:", this.lastError);
    }
  }

  private pollMock(): void {
    if (this.readings.length === 0) {
      // Backfill history once on startup.
      this.merge(generateHistory());
    } else {
      this.merge([generateOne()]);
    }
    this.lastPollOk = true;
    this.lastError = null;
  }

  async pollOnce(): Promise<void> {
    if (config.useMock) this.pollMock();
    else await this.pollSheet();
  }

  start(): void {
    const interval = config.useMock ? MOCK_STEP_MS : config.pollIntervalMs;
    // Prime immediately, then on the interval.
    void this.pollOnce();
    setInterval(() => void this.pollOnce(), interval);
    console.log(
      `[store] polling ${this.source} every ${interval}ms` +
        (config.useMock ? ` (mock: ${config.mockReason})` : "")
    );
  }
}

export const store = new ReadingStore();
