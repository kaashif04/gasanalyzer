import { useEffect, useState } from "react";
import { useHistory } from "./useHistory";
import { BASELINE } from "../lib/constants";
import { Reading } from "../lib/types";

/**
 * A slowly-sliding lookback window used to detect the "control" baseline
 * plateau. Doesn't need the live feed's second-level freshness, so it
 * refreshes on its own slower cadence (BASELINE.refreshMs) independent of the
 * 1h sparkline history.
 */
export function useBaselineHistory(): { readings: Reading[]; loading: boolean } {
  const [windowEnd, setWindowEnd] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setWindowEnd(Date.now()), BASELINE.refreshMs);
    return () => clearInterval(id);
  }, []);
  // refreshMs=0: the ticking windowEnd above is what drives re-fetches, so we
  // don't need useHistory's own interval too.
  const { readings, loading } = useHistory(windowEnd - BASELINE.lookbackMs, windowEnd, 0);
  return { readings, loading };
}
