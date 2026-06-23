import { motion, useReducedMotion } from "framer-motion";
import { DiagLevel } from "../../lib/diagnostics";
import { DiagIcon } from "./icons";

const META: Record<DiagLevel, { label: string; color: string }> = {
  green: { label: "Healthy", color: "#34d399" },
  amber: { label: "Attention", color: "#fbbf24" },
  red: { label: "Action needed", color: "#fb5d6b" },
};

/** Big one-glance health badge for the top of the Diagnostics page. */
export default function HealthBadge({
  level,
  size = "lg",
}: {
  level: DiagLevel;
  size?: "lg" | "sm";
}) {
  const reduce = useReducedMotion();
  const meta = META[level];
  const big = size === "lg";
  return (
    <motion.div
      key={level}
      initial={reduce ? false : { scale: 0.96, opacity: 0.6 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`inline-flex items-center gap-2.5 rounded-full font-semibold ${
        big ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"
      }`}
      style={{
        color: meta.color,
        backgroundColor: `${meta.color}14`,
        boxShadow: `inset 0 0 0 1px ${meta.color}44, 0 0 24px -8px ${meta.color}`,
      }}
    >
      <span className="relative flex">
        <DiagIcon level={level} size={big ? 14 : 11} />
        {level !== "green" && !reduce && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 2px ${meta.color}` }}
            animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.8, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
      </span>
      {meta.label}
    </motion.div>
  );
}
