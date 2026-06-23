import { motion, useReducedMotion } from "framer-motion";

export interface RangePreset {
  label: string;
  ms: number;
}

export const PRESETS: RangePreset[] = [
  { label: "1H", ms: 3_600_000 },
  { label: "6H", ms: 6 * 3_600_000 },
  { label: "24H", ms: 24 * 3_600_000 },
  { label: "3D", ms: 3 * 86_400_000 },
  { label: "7D", ms: 7 * 86_400_000 },
];

/** Quick relative-range presets with a sliding highlight. */
export default function RangePicker({
  valueMs,
  onChange,
}: {
  valueMs: number;
  onChange: (ms: number) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex rounded-lg border border-white/[0.06] bg-ink-850 p-0.5">
      {PRESETS.map((p) => {
        const active = Math.abs(valueMs - p.ms) < 1000;
        return (
          <button
            key={p.label}
            onClick={() => onChange(p.ms)}
            className={`relative z-10 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active ? "text-ink-900" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {active && (
              <motion.span
                layoutId="range-pill"
                className="absolute inset-0 rounded-md bg-signal"
                style={{ zIndex: -1 }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
