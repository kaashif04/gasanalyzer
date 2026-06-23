import { StatusLevel } from "../../lib/types";
import { DiagLevel } from "../../lib/diagnostics";

type IconProps = { size?: number; className?: string };

/** Status icons use DISTINCT SHAPES, not just color, so they remain readable
 *  for color-blind users: ● nominal, ▲ drift, ■ fault, ◌ stale. */
export function StatusIcon({
  level,
  size = 12,
  className,
}: { level: StatusLevel } & IconProps) {
  const s = size;
  if (level === "nominal")
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" className={className}>
        <circle cx="6" cy="6" r="5" fill="currentColor" />
      </svg>
    );
  if (level === "drift")
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" className={className}>
        <path d="M6 1 L11 11 L1 11 Z" fill="currentColor" />
      </svg>
    );
  if (level === "fault")
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" className={className}>
        <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor" />
      </svg>
    );
  // stale
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" className={className}>
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="2.2 2.2"
      />
    </svg>
  );
}

const DIAG_TO_STATUS: Record<DiagLevel, StatusLevel> = {
  green: "nominal",
  amber: "drift",
  red: "fault",
};
export function DiagIcon({
  level,
  size,
  className,
}: { level: DiagLevel } & IconProps) {
  return (
    <StatusIcon level={DIAG_TO_STATUS[level]} size={size} className={className} />
  );
}

export function SpikeIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} fill="none">
      <path
        d="M2 11 L5 11 L7 4 L9 13 L11 8 L14 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OfflineIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} fill="none">
      <path
        d="M2 5.5 C5 3 11 3 14 5.5 M4 8.5 C6 6.8 10 6.8 12 8.5 M6.2 11.3 C7.2 10.6 8.8 10.6 9.8 11.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.6"
      />
      <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function JumpIcon({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} fill="none">
      <path d="M6 3 H13 V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
