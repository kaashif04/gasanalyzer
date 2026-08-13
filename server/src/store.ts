import { config } from "./config.js";
import {
  fetchDataRows,
  fetchHeader,
  fetchTimestampColumn,
  parseTimestamp,
} from "./sheets.js";
import { generateHistory, generateOne, MOCK_STEP_MS } from "./mock.js";
import { Reading } from "./types.js";

/**
 * Holds all readings in memory, sorted ascending by time. A week of 30s data is
 * ~20k rows — trivial to keep resident, and it lets /api/history be a fast
 * in-memory filter rather than a per-request round-trip to Google.
 *
 * Memory cap: on startup the store skips old rows so only the last
 * config.historyDays of data is fetched. The merge() method also trims
 * the in-memory array if it would grow beyond that window, so the footprint
 * stays bounded even across a very long continuous uptime.
 */
class ReadingStore {
  private readings: Reading[] = [];
  private byTs = new Set<number>();
  /** How many data rows (excluding header) we've already pulled from the
   *  sheet. Lets each poll ask for only what's new instead of re-fetching
   *  and re-parsing the whole, ever-growing sheet every cycle. Resets to 0
   *  on process restart; the startup skip logic in pollSheet() then fast-
   *  forwards past old history before the first real fetch. */
  private ingestedDataRows = 0;

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

      // Trim readings older than the history window to keep memory bounded.
      // 2880 = 2 readings/min × 60 min/h × 24 h/day. The factor of 1.1
      // gives a small buffer so a temporary surge in readings doesn't cause
      // constant eviction; the startup skip is the primary guard, this is
      // just a backstop for very long uptimes.
      const MAX_ROWS = Math.ceil(config.historyDays * 2880 * 1.1);
      if (this.readings.length > MAX_ROWS) {
        const evict = this.readings.splice(0, this.readings.length - MAX_ROWS);
        for (const r of evict) this.byTs.delete(r.ts);
      }
    }
    return added;
  }

  private async pollSheet(): Promise<void> {
    try {
      const header = await fetchHeader();

      // On the very first poll after (re)start: fast-forward past old history
      // so we don't load 100k+ rows into memory. Fetch only the timestamp
      // column (~4 MB for 121k rows vs ~80 MB for all columns), scan backward
      // to find the row that sits at the history cutoff, then set
      // ingestedDataRows to skip everything older than that.
      if (this.ingestedDataRows === 0) {
        const cutoffMs = Date.now() - config.historyDays * 86_400_000;
        const timestamps = await fetchTimestampColumn();
        let skipRows = 0;
        for (let i = timestamps.length - 1; i >= 0; i--) {
          const ts = parseTimestamp(timestamps[i]);
          if (!Number.isNaN(ts) && ts < cutoffMs) {
            skipRows = i + 1; // all rows up to and including this one are old
            break;
          }
        }
        this.ingestedDataRows = skipRows;
        console.log(
          `[store] history window: skipping ${skipRows}/${timestamps.length}` +
            ` data rows (loading last ${timestamps.length - skipRows})`
        );
      }

      const { readings, rawRowCount } = await fetchDataRows(
        header,
        this.ingestedDataRows + 1
      );
      // Additive: never wipe what we already hold. A transient fetch error
      // leaves existing in-memory history untouched (see catch below), and a
      // successful poll only ever costs what's actually new (normally one
      // row), not the whole sheet. Advance by the RAW row count, not the
      // parsed count, so a single bad-timestamp row can't desync the cursor
      // from the sheet's real row numbers.
      const added = this.merge(readings);
      this.ingestedDataRows += rawRowCount;
      this.lastPollOk = true;
      this.lastError = null;
      if (added) this.lastIngestAt = Date.now();
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
