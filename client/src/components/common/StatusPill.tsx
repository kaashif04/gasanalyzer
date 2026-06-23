import { StatusLevel } from "../../lib/types";
import { STATUS_META } from "../../lib/status";
import { StatusIcon } from "./icons";

/** Small status pill: shape icon + label + tinted background. */
export default function StatusPill({
  level,
  label,
  className = "",
}: {
  level: StatusLevel;
  label?: string;
  className?: string;
}) {
  const meta = STATUS_META[level];
  return (
    <span
      className={`pill ${className}`}
      style={{
        color: meta.color,
        backgroundColor: `${meta.color}1a`,
        boxShadow: `inset 0 0 0 1px ${meta.color}33`,
      }}
    >
      <StatusIcon level={level} size={9} />
      {label ?? meta.label}
    </span>
  );
}
