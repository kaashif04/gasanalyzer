import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHistory } from "../api/client";
import { Reading } from "../lib/types";

interface State {
  readings: Reading[];
  loading: boolean;
  error: string | null;
  source: "sheet" | "mock" | null;
  reload: () => void;
}

/**
 * Fetch readings for a [from,to] window, re-fetching when the window changes
 * and (optionally) on a refresh interval so open pages stay live.
 */
export function useHistory(
  fromMs: number,
  toMs: number,
  refreshMs = 30_000
): State {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"sheet" | "mock" | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const res = await fetchHistory(fromMs, toMs);
      if (id !== seq.current) return; // a newer request superseded us
      setReadings(res.readings);
      setSource(res.source);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [fromMs, toMs]);

  useEffect(() => {
    setLoading(true);
    void load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  return { readings, loading, error, source, reload: load };
}
