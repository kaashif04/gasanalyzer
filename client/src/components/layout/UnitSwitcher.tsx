import { motion, useReducedMotion } from "framer-motion";
import { useUnits } from "../../context/UnitContext";
import { Unit } from "../../lib/types";
import { UNIT_META } from "../../lib/units";

const UNITS: Unit[] = ["voltage", "ppm", "percent"];

/** App-wide unit segmented control + a raw-overlay toggle. The sliding
 *  highlight uses a shared layoutId for a smooth crossfade between segments. */
export default function UnitSwitcher() {
  const { unit, setUnit, showRaw, setShowRaw } = useUnits();
  const reduce = useReducedMotion();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Display unit"
        className="relative flex rounded-lg border border-white/[0.06] bg-ink-850 p-0.5"
      >
        {UNITS.map((u) => {
          const active = unit === u;
          return (
            <button
              key={u}
              role="radio"
              aria-checked={active}
              onClick={() => setUnit(u)}
              className={`relative z-10 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? "text-ink-900" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="unit-pill"
                  className="absolute inset-0 rounded-md bg-signal"
                  transition={
                    reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }
                  }
                  style={{ zIndex: -1 }}
                />
              )}
              {UNIT_META[u].label}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => setShowRaw(!showRaw)}
        aria-pressed={showRaw}
        title="Overlay the raw, uncompensated channel"
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          showRaw
            ? "border-info/40 bg-info/10 text-info"
            : "border-white/[0.06] bg-ink-850 text-slate-400 hover:text-slate-200"
        }`}
      >
        Raw overlay
      </button>
    </div>
  );
}
