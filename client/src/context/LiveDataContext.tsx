import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { fetchHistory, fetchLatest } from "../api/client";
import {
  LIVE_POLL_MS,
  PROLONGED_STALE_MS,
  RESUME_NOTICE_MS,
  STALE_AFTER_MS,
} from "../lib/constants";
import { LatestResponse, Reading } from "../lib/types";

/** Recorded once when a new row ends a gap that had gone stale (>90s) — lets
 *  the UI show "was powered off, resumed at X" instead of treating every gap
 *  the same regardless of cause. `clean` reflects whether the resuming row
 *  carried a firmware session_start=1 marker (a real boot) — see
 *  PROLONGED_STALE_MS / RESUME_NOTICE_MS in constants.ts for the timings. */
export interface ResumeInfo {
  resumedAt: number;
  gapMs: number;
  clean: boolean;
}

interface LiveState {
  latest: Reading | null;
  /** The reading shown one tick ago — lets cards tween from old → new. */
  previous: Reading | null;
  meta: LatestResponse | null;
  /** Age of the latest row's own timestamp, recomputed every second. */
  rowAgeMs: number | null;
  isStale: boolean;
  /** Stale for long enough that a power-cycle no longer explains it on its
   *  own — worth the full alarm regardless of cause. */
  isProlongedStale: boolean;
  /** Details of the most recent gap-ending row, if any. */
  resumeInfo: ResumeInfo | null;
  /** Whether `resumeInfo` is still within its display grace period. */
  showResumeNotice: boolean;
  /** Pulses true briefly when a genuinely new row lands. */
  freshTick: number;
  /** Rolling ~1h history for the dashboard sparklines. */
  history1h: Reading[];
  connected: boolean;
}

const Ctx = createContext<LiveState | null>(null);

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [latest, setLatest] = useState<Reading | null>(null);
  const [previous, setPrevious] = useState<Reading | null>(null);
  const [meta, setMeta] = useState<LatestResponse | null>(null);
  const [history1h, setHistory1h] = useState<Reading[]>([]);
  const [freshTick, setFreshTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastTsRef = useRef<number | null>(null);
  // Mirror of `latest` so the poll closure can read it without re-subscribing.
  const latestRef = useRef<Reading | null>(null);
  useEffect(() => {
    latestRef.current = latest;
  }, [latest]);

  // Poll the latest reading from our backend.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetchLatest();
        if (!alive) return;
        setMeta(res);
        setConnected(true);
        if (res.reading) {
          const incomingTs = res.reading.ts;
          if (lastTsRef.current == null) {
            setLatest(res.reading);
            setPrevious(res.reading);
          } else if (incomingTs !== lastTsRef.current) {
            // A new row landed — shift current → previous and pulse.
            const priorTs = latestRef.current?.ts;
            if (priorTs != null && incomingTs - priorTs > STALE_AFTER_MS) {
              setResumeInfo({
                resumedAt: incomingTs,
                gapMs: incomingTs - priorTs,
                clean: res.reading.session_start === 1,
              });
            }
            setPrevious((p) => (latestRef.current ?? p));
            setLatest(res.reading);
            setFreshTick((t) => t + 1);
            // Append to the rolling history so sparklines move between refreshes.
            setHistory1h((h) =>
              h.length && h[h.length - 1].ts === incomingTs
                ? h
                : [...h, res.reading!].slice(-720)
            );
          }
          lastTsRef.current = incomingTs;
        }
      } catch {
        if (alive) setConnected(false);
      }
    };
    void tick();
    const id = setInterval(tick, LIVE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Full 1h history refresh on mount + every 30s (covers any gaps/back-fill).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const to = Date.now();
        const res = await fetchHistory(to - 3_600_000, to);
        if (alive && res.readings.length) setHistory1h(res.readings.slice(-720));
      } catch {
        /* ignore — poll loop reports connection state */
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 1s clock so "x ago" / staleness updates smoothly without re-fetching.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const rowAgeMs = latest ? now - latest.ts : null;
  const isStale = rowAgeMs != null ? rowAgeMs > STALE_AFTER_MS : true;
  const isProlongedStale = rowAgeMs != null && rowAgeMs > PROLONGED_STALE_MS;
  const showResumeNotice =
    resumeInfo != null && now - resumeInfo.resumedAt < RESUME_NOTICE_MS;

  const value: LiveState = {
    latest,
    previous,
    meta,
    rowAgeMs,
    isStale,
    isProlongedStale,
    resumeInfo,
    showResumeNotice,
    freshTick,
    history1h,
    connected,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveData(): LiveState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLiveData must be used within LiveDataProvider");
  return v;
}
