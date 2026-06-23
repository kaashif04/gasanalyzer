import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useHistory } from "../hooks/useHistory";
import { useUnits } from "../context/UnitContext";
import { ENV_COLORS, MQ_CHANNELS } from "../lib/constants";
import { Reading } from "../lib/types";
import { convertCo2, convertMq, isEstimatedUnit, UNIT_META } from "../lib/units";
import { axisTime, clockTime, dateTime, fmt } from "../lib/format";
import RangePicker from "../components/common/RangePicker";
import EstimatedTag from "../components/common/EstimatedTag";
import { PageHeader } from "./LiveDashboard";

type EnvKey = "none" | "co2_ppm" | "temp_c" | "humidity_pct";
const ENV_OPTS: { key: EnvKey; label: string; color: string }[] = [
  { key: "none", label: "None", color: "#64748b" },
  { key: "co2_ppm", label: "CO₂", color: ENV_COLORS.co2 },
  { key: "temp_c", label: "Temp", color: ENV_COLORS.temp },
  { key: "humidity_pct", label: "Humidity", color: ENV_COLORS.humidity },
];

interface ChannelSel {
  comp: boolean;
  raw: boolean;
}

export default function Trends() {
  const { unit, co2Unit } = useUnits();
  const [rangeMs, setRangeMs] = useState(6 * 3_600_000);
  const [now] = useState(() => Date.now());
  // Anchor the window; live refresh keeps "to" near present via useHistory poll.
  const to = now;
  const from = to - rangeMs;
  const { readings, loading } = useHistory(from, to);

  const [sel, setSel] = useState<Record<string, ChannelSel>>({
    mq4_1: { comp: true, raw: false },
    mq4_2: { comp: true, raw: false },
    mq8_1: { comp: false, raw: false },
    mq8_2: { comp: false, raw: false },
  });
  const [env, setEnv] = useState<EnvKey>("temp_c");

  // Drag-to-zoom domain over the X axis.
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [dragA, setDragA] = useState<number | null>(null);
  const [dragB, setDragB] = useState<number | null>(null);

  const data = useMemo(() => {
    return readings.map((r: Reading) => {
      const row: Record<string, number> = { ts: r.ts };
      for (const ch of MQ_CHANNELS) {
        const s = sel[ch.id];
        if (s?.comp) row[`${ch.id}_comp`] = convertMq(r[ch.comp], ch.sensor, unit);
        if (s?.raw) row[`${ch.id}_raw`] = convertMq(r[ch.raw], ch.sensor, unit);
      }
      if (env === "co2_ppm") row.env = convertCo2(r.co2_ppm, co2Unit);
      else if (env !== "none") row.env = r[env];
      return row;
    });
  }, [readings, sel, unit, env, co2Unit]);

  const view = useMemo(() => {
    if (!zoom) return data;
    const [lo, hi] = zoom;
    return data.filter((d) => d.ts >= lo && d.ts <= hi);
  }, [data, zoom]);

  const spanMs = zoom ? zoom[1] - zoom[0] : rangeMs;
  const envMeta = ENV_OPTS.find((e) => e.key === env)!;
  const mqUnit = UNIT_META[unit].mqSuffix;

  const commitZoom = () => {
    if (dragA != null && dragB != null && Math.abs(dragA - dragB) > 1) {
      setZoom([Math.min(dragA, dragB), Math.max(dragA, dragB)]);
    }
    setDragA(null);
    setDragB(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trends"
        subtitle="Overlay channels · drag on the chart to zoom · unit toggle applies"
        right={<RangePicker valueMs={rangeMs} onChange={(ms) => { setRangeMs(ms); setZoom(null); }} />}
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Selector rail */}
        <div className="panel h-fit p-4">
          <h3 className="label-eyebrow mb-3">Gas channels</h3>
          <div className="space-y-2.5">
            {MQ_CHANNELS.map((ch) => {
              const s = sel[ch.id] ?? { comp: false, raw: false };
              return (
                <div key={ch.id} className="rounded-lg bg-ink-850/60 p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: ch.color }}
                    />
                    <span className="text-sm font-medium text-slate-200">
                      {ch.label}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <ToggleChip
                      active={s.comp}
                      color={ch.color}
                      onClick={() =>
                        setSel((p) => ({ ...p, [ch.id]: { ...s, comp: !s.comp } }))
                      }
                    >
                      comp
                    </ToggleChip>
                    <ToggleChip
                      active={s.raw}
                      color={ch.color}
                      dashed
                      title="Raw, uncompensated — still carries heavy thermal drift. Secondary/diagnostic overlay only."
                      onClick={() =>
                        setSel((p) => ({ ...p, [ch.id]: { ...s, raw: !s.raw } }))
                      }
                    >
                      raw
                    </ToggleChip>
                  </div>
                </div>
              );
            })}
          </div>

          <h3 className="label-eyebrow mb-2 mt-5">Environment overlay</h3>
          <p className="mb-2 text-[0.65rem] text-slate-500">
            Plotted on the right axis (own scale).
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {ENV_OPTS.map((e) => (
              <button
                key={e.key}
                onClick={() => setEnv(e.key)}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  env === e.key
                    ? "text-ink-900"
                    : "bg-ink-850 text-slate-400 hover:text-slate-200"
                }`}
                style={env === e.key ? { backgroundColor: e.color } : undefined}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>
                {loading ? "loading…" : `${readings.length} points · left axis ${mqUnit}`}
                {env !== "none" && ` · right axis ${envMeta.label}`}
              </span>
              {isEstimatedUnit(unit) && <EstimatedTag />}
            </div>
            {zoom && (
              <button
                onClick={() => setZoom(null)}
                className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/5"
              >
                Reset zoom
              </button>
            )}
          </div>
          <div className="h-[420px] select-none">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={view}
                margin={{ top: 8, right: env !== "none" ? 8 : 4, left: -8, bottom: 0 }}
                onMouseDown={(e) => e?.activeLabel && setDragA(Number(e.activeLabel))}
                onMouseMove={(e) =>
                  dragA != null && e?.activeLabel && setDragB(Number(e.activeLabel))
                }
                onMouseUp={commitZoom}
              >
                <CartesianGrid stroke="#1d2a3d" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  tickFormatter={(t) => axisTime(t, spanMs)}
                  stroke="#475569"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  minTickGap={48}
                />
                <YAxis
                  yAxisId="mq"
                  stroke="#475569"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  width={56}
                  tickFormatter={(v) => fmt(v, unit === "ppm" ? 0 : 2)}
                />
                {env !== "none" && (
                  <YAxis
                    yAxisId="env"
                    orientation="right"
                    stroke={envMeta.color}
                    tick={{ fontSize: 11, fill: envMeta.color }}
                    width={50}
                  />
                )}
                <Tooltip content={<TrendTooltip unit={mqUnit} envMeta={envMeta} />} />

                {MQ_CHANNELS.flatMap((ch) => {
                  const s = sel[ch.id];
                  const lines = [];
                  if (s?.comp)
                    lines.push(
                      <Line
                        key={`${ch.id}_comp`}
                        yAxisId="mq"
                        type="monotone"
                        dataKey={`${ch.id}_comp`}
                        name={`${ch.label} comp`}
                        stroke={ch.color}
                        strokeWidth={1.8}
                        dot={false}
                        isAnimationActive={!zoom}
                        animationDuration={500}
                        connectNulls
                      />
                    );
                  if (s?.raw)
                    lines.push(
                      <Line
                        key={`${ch.id}_raw`}
                        yAxisId="mq"
                        type="monotone"
                        dataKey={`${ch.id}_raw`}
                        name={`${ch.label} raw`}
                        stroke={ch.color}
                        strokeWidth={1.2}
                        strokeDasharray="4 3"
                        strokeOpacity={0.65}
                        dot={false}
                        isAnimationActive={!zoom}
                        animationDuration={500}
                        connectNulls
                      />
                    );
                  return lines;
                })}

                {env !== "none" && (
                  <Line
                    yAxisId="env"
                    type="monotone"
                    dataKey="env"
                    name={envMeta.label}
                    stroke={envMeta.color}
                    strokeWidth={1.5}
                    strokeOpacity={0.85}
                    dot={false}
                    isAnimationActive={!zoom}
                    animationDuration={500}
                    connectNulls
                  />
                )}

                {dragA != null && dragB != null && (
                  <ReferenceArea
                    yAxisId="mq"
                    x1={Math.min(dragA, dragB)}
                    x2={Math.max(dragA, dragB)}
                    strokeOpacity={0}
                    fill="#38e8c8"
                    fillOpacity={0.12}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({
  active,
  color,
  dashed,
  title,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  dashed?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
        active ? "text-slate-100" : "border-white/[0.06] text-slate-500 hover:text-slate-300"
      }`}
      style={
        active
          ? { borderColor: `${color}66`, backgroundColor: `${color}1a` }
          : undefined
      }
    >
      <span
        className="h-0 w-3 border-t-2"
        style={{
          borderColor: active ? color : "#475569",
          borderStyle: dashed ? "dashed" : "solid",
        }}
      />
      {children}
    </button>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
  unit,
  envMeta,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  label?: number;
  unit: string;
  envMeta: { key: string; label: string };
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-ink-900/95 px-3 py-2 text-xs shadow-panel backdrop-blur">
      <div className="mb-1 font-medium text-slate-300">
        {label ? dateTime(label) : ""} · {label ? clockTime(label).slice(6) : ""}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: p.color }}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
          </span>
          <span className="tnum text-slate-200">
            {fmt(p.value, 2)}{" "}
            <span className="text-slate-500">
              {p.dataKey === "env" ? (envMeta.key === "co2_ppm" ? "" : "") : unit}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
