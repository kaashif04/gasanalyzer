import { motion, useReducedMotion } from "framer-motion";
import { useLiveData } from "../../context/LiveDataContext";
import { ago } from "../../lib/format";
import { OfflineIcon } from "../common/icons";

/** Compact live-feed indicator: shows source (live sheet / mock / offline),
 *  a breathing dot, and "last updated x ago". Goes stale-red past 90s. */
export default function ConnectionStatus() {
  const { meta, rowAgeMs, isStale, connected, freshTick } = useLiveData();
  const reduce = useReducedMotion();

  const mock = meta?.source === "mock";
  const offline = !connected;

  const color = offline || isStale ? "#fb5d6b" : mock ? "#60a5fa" : "#34d399";
  const text = offline
    ? "Backend unreachable"
    : isStale
    ? "Feed stale"
    : mock
    ? "Mock feed"
    : "Live";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="relative flex h-2.5 w-2.5">
        {!reduce && !offline && (
          <motion.span
            key={freshTick}
            className="absolute inline-flex h-full w-full rounded-full"
            style={{ backgroundColor: color }}
            initial={{ opacity: 0.7, scale: 1 }}
            animate={{ opacity: 0, scale: 2.6 }}
            transition={{ duration: isStale ? 1.8 : 1.2, repeat: Infinity }}
          />
        )}
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
        />
      </span>
      <span className="font-medium" style={{ color }}>
        {offline ? (
          <span className="inline-flex items-center gap-1">
            <OfflineIcon size={13} /> {text}
          </span>
        ) : (
          text
        )}
      </span>
      {!offline && (
        <span className="text-slate-500 tnum">· {ago(rowAgeMs)}</span>
      )}
    </div>
  );
}
