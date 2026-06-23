import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import AnimatedNumber from "../common/AnimatedNumber";
import Sparkline from "../common/Sparkline";
import StatusPill from "../common/StatusPill";
import EstimatedTag from "../common/EstimatedTag";
import { SpikeIcon, StatusIcon } from "../common/icons";
import { STATUS_META } from "../../lib/status";
import { StatusLevel } from "../../lib/types";
import { fmt, duration } from "../../lib/format";

export interface SensorCardBaseline {
  available: boolean;
  /** Display-unit baseline (control) value. */
  value: number;
  /** Display-unit live − baseline. */
  delta: number;
  deltaPct: number | null;
  stableDurationMs: number;
  isAtBaseline: boolean;
  /** True if |delta| is smaller than the channel's own measured noise floor
   *  — i.e. this isn't a confirmed change, just normal sensor noise. */
  withinNoiseFloor: boolean;
}

export interface SensorCardModel {
  key: string;
  title: string;
  subLabel?: string;
  status: StatusLevel;
  value: number;
  decimals: number;
  unitSuffix: string;
  color: string;
  spark: number[];
  secondarySpark?: number[];
  secondaryNote?: string;
  estimated?: boolean;
  spikeFiltered?: boolean;
  titleAccessory?: ReactNode;
  baseline?: SensorCardBaseline;
  /** Small inline note next to the value, e.g. the same reading in its other
   *  unit ("≈ 0.132%") — exact unit math, shown alongside, not a toggle. */
  valueNote?: string;
}

export default function SensorCard({
  model,
  stale,
  freshTick,
}: {
  model: SensorCardModel;
  stale: boolean;
  freshTick: number;
}) {
  const reduce = useReducedMotion();
  const level: StatusLevel = stale ? "stale" : model.status;
  const meta = STATUS_META[level];

  return (
    <motion.div
      layout
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`panel relative overflow-hidden p-4 transition-colors duration-200 ${
        stale ? "animate-stalepulse" : ""
      }`}
      style={{
        boxShadow: `inset 0 0 0 1px ${meta.color}22, 0 8px 30px -12px rgba(0,0,0,0.7)`,
      }}
    >
      {/* status edge accent */}
      <span
        className="absolute inset-y-0 left-0 w-[3px] transition-colors duration-300"
        style={{ backgroundColor: meta.color, boxShadow: `0 0 12px ${meta.color}` }}
      />

      {/* fresh-row pulse ring */}
      {!reduce && !stale && (
        <motion.span
          key={freshTick}
          className="pointer-events-none absolute inset-0 rounded-2xl"
          initial={{ boxShadow: `inset 0 0 0 1.5px ${model.color}88`, opacity: 0.9 }}
          animate={{ boxShadow: `inset 0 0 0 1.5px ${model.color}00`, opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      )}

      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{model.title}</span>
            {model.titleAccessory}
          </div>
          {model.subLabel && (
            <div className="text-[0.68rem] text-slate-500">{model.subLabel}</div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1" style={{ color: meta.color }}>
            <StatusIcon level={level} size={10} />
          </span>
          {model.spikeFiltered && (
            <span
              className="pill bg-info/10 text-info"
              title="Firmware filtered a same-cycle multi-channel electrical glitch on this reading; the rolling average was used. Informational."
            >
              <SpikeIcon size={11} /> glitch filtered
            </span>
          )}
        </div>
      </div>

      <div className="flex items-end gap-1.5">
        <AnimatedNumber
          value={model.value}
          decimals={model.decimals}
          className="text-3xl font-semibold leading-none text-slate-50"
        />
        <span className="mb-0.5 text-sm text-slate-400">{model.unitSuffix}</span>
        {model.estimated && (
          <span className="mb-0.5 ml-0.5">
            <EstimatedTag />
          </span>
        )}
        {model.valueNote && (
          <span className="tnum mb-0.5 ml-1 text-xs text-slate-500">{model.valueNote}</span>
        )}
      </div>

      {model.baseline && (
        <BaselineRow baseline={model.baseline} decimals={model.decimals} unitSuffix={model.unitSuffix} />
      )}

      <div className="mt-3 flex items-end justify-between gap-2">
        <Sparkline
          values={model.spark}
          secondary={model.secondarySpark}
          referenceValue={model.baseline?.available ? model.baseline.value : undefined}
          color={stale ? "#64748b" : model.color}
          width={150}
          height={42}
        />
        <div className="flex flex-col items-end gap-1">
          <StatusPill level={level} />
          {model.secondaryNote && (
            <span className="text-[0.6rem] text-slate-500">{model.secondaryNote}</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function BaselineRow({
  baseline,
  decimals,
  unitSuffix,
}: {
  baseline: SensorCardBaseline;
  decimals: number;
  unitSuffix: string;
}) {
  if (!baseline.available) {
    return (
      <div
        className="mt-2.5 rounded-lg bg-ink-850/60 px-2.5 py-1.5 text-[0.7rem] text-slate-600"
        title="Needs roughly 20+ minutes of steady readings to establish a control baseline."
      >
        Control: establishing…
      </div>
    );
  }

  const controlLabel = (
    <span
      className="text-slate-500"
      title="Automatically detected from the most recent sustained stretch of steady readings — this updates if conditions settle at a new level for long enough, rather than staying fixed."
    >
      Control <span className="tnum text-slate-300">{fmt(baseline.value, decimals)}</span>
      <span className="text-slate-600"> {unitSuffix}</span>
      <span className="ml-1.5 text-slate-600">· {duration(baseline.stableDurationMs)} stable</span>
    </span>
  );

  if (baseline.withinNoiseFloor) {
    return (
      <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-ink-850/60 px-2.5 py-1.5 text-[0.7rem]">
        {controlLabel}
        <span
          className="tnum flex items-center gap-1 whitespace-nowrap font-medium text-slate-500"
          title="This change is smaller than the channel's measured noise floor — not yet a confirmed change."
        >
          <span aria-hidden>≈</span> within noise
        </span>
      </div>
    );
  }

  const sign = baseline.delta > 0 ? "+" : baseline.delta < 0 ? "−" : "";
  const glyph = baseline.delta > 0 ? "▲" : baseline.delta < 0 ? "▼" : "●";
  const pct =
    baseline.deltaPct != null && Number.isFinite(baseline.deltaPct)
      ? ` (${sign}${Math.min(Math.abs(baseline.deltaPct), 999).toFixed(0)}%)`
      : "";

  return (
    <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-ink-850/60 px-2.5 py-1.5 text-[0.7rem]">
      {controlLabel}
      <span className="tnum flex items-center gap-1 whitespace-nowrap font-medium text-info">
        <span aria-hidden>{glyph}</span>
        {sign}
        {fmt(Math.abs(baseline.delta), decimals)}
        {pct}
      </span>
    </div>
  );
}
