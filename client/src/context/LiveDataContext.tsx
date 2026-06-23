import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { fetchHistory, fetchLatest } from "../api/client";
import { LIVE_POLL_MS, STALE_AFTER_MS } from "../lib/constants";
import { LatestResponse, Reading } from "../lib/types";

interface LiveState {
  latest: Reading | null;
  /** The reading shown one tick ago — lets cards tween from old → new. */
  previous: Reading | null;
  meta: LatestResponse | null;
  /** Age of the latest row's own timestamp, recomputed every second. */
  rowAgeMs: number | null;
  isStale: boolean;
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

  const value: LiveState = {
    latest,
    previous,
    meta,
    rowAgeMs,
    isStale,
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
