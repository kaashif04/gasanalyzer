import { useId, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface Props {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
  /** Optional secondary (raw) trace, drawn dimmer/dashed beneath. */
  secondary?: number[];
  secondaryColor?: string;
  /** Optional horizontal "control baseline" reference line, same unit/scale
   *  as `values`. Included in the domain calc so it's never clipped even if
   *  it sits outside the visible trace's own min/max. */
  referenceValue?: number;
  referenceColor?: string;
}

/** Lightweight inline-SVG sparkline with a phosphor glow + area fill and a
 *  draw-in animation. Cheaper and smoother than a full chart per card. */
export default function Sparkline({
  values,
  color = "#38e8c8",
  height = 44,
  width = 150,
  secondary,
  secondaryColor = "#64748b",
  referenceValue,
  referenceColor = "#5eead4",
}: Props) {
  const reduce = useReducedMotion();
  const gradId = useId();

  const { line, area, dot, secLine, refY } = useMemo(() => {
    const clean = values.filter(Number.isFinite);
    if (clean.length < 2)
      return {
        line: "",
        area: "",
        dot: null as null | [number, number],
        secLine: "",
        refY: null as number | null,
      };

    const hasRef = referenceValue != null && Number.isFinite(referenceValue);
    const all = [
      ...clean,
      ...(secondary ? secondary.filter(Number.isFinite) : []),
      ...(hasRef ? [referenceValue as number] : []),
    ];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const pad = 3;
    const w = width - pad * 2;
    const h = height - pad * 2;

    const toXY = (arr: number[]) =>
      arr.map((v, i) => {
        const x = pad + (i / (arr.length - 1)) * w;
        const y = pad + h - ((v - min) / span) * h;
        return [x, y] as [number, number];
      });

    const pts = toXY(values.map((v) => (Number.isFinite(v) ? v : min)));
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const areaPath =
      `${path} L${pts[pts.length - 1][0].toFixed(1)},${(height - pad).toFixed(1)} ` +
      `L${pts[0][0].toFixed(1)},${(height - pad).toFixed(1)} Z`;

    const sec = secondary
      ? toXY(secondary.map((v) => (Number.isFinite(v) ? v : min)))
          .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
          .join(" ")
      : "";

    const ref = hasRef ? pad + h - ((referenceValue! - min) / span) * h : null;

    return {
      line: path,
      area: areaPath,
      dot: pts[pts.length - 1],
      secLine: sec,
      refY: ref,
    };
  }, [values, secondary, referenceValue, width, height]);

  if (!line)
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[0.65rem] text-slate-600"
      >
        no data
      </div>
    );

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      {refY != null && (
        <line
          x1={0}
          x2={width}
          y1={refY}
          y2={refY}
          stroke={referenceColor}
          strokeWidth={1}
          strokeDasharray="1.5 2.5"
          opacity={0.6}
        />
      )}
      {secLine && (
        <path
          d={secLine}
          fill="none"
          stroke={secondaryColor}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.7}
        />
      )}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
        initial={reduce ? false : { pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.7, ease: "easeOut" }}
      />
      {dot && (
        <motion.circle
          cx={dot[0]}
          cy={dot[1]}
          r={2.6}
          fill={color}
          initial={reduce ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, delay: reduce ? 0 : 0.5 }}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      )}
    </svg>
  );
}
