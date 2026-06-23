import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useHistory } from "../hooks/useHistory";
import { useLiveData } from "../context/LiveDataContext";
import { MQ_CHANNELS, PAIR_RATIO } from "../lib/constants";
import { CORRELATION } from "../lib/constants";
import {
  classifyDisturbances,
  detectSpikes,
  overallHealth,
  pairAgreements,
  statusToDiag,
  tempCorrelations,
  DiagLevel,
} from "../lib/diagnostics";
import {
  co2Status,
  humidityStatus,
  mqStatus,
  tempStatus,
} from "../lib/status";
import { axisTime, clockTime, dateTime, fmt } from "../lib/format";
import { worst } from "../lib/diagnostics";
import RangePicker from "../components/common/RangePicker";
import HealthBadge from "../components/common/HealthBadge";
import { DiagIcon, JumpIcon, SpikeIcon } from "../components/common/icons";
import { PageHeader } from "./LiveDashboard";

const LEVEL_COLOR: Record<DiagLevel, string> = {
  green: "#34d399",
  amber: "#fbbf24",
  red: "#fb5d6b",
};

export default function Diagnostics() {
  const [rangeMs, setRangeMs] = useState(6 * 3_600_000);
  const [now] = useState(() => Date.now());
  const { readings, loading } = useHistory(now - rangeMs, now);
  const { latest } = useLiveData();
  const chartRef = useRef<HTMLDivElement>(null);
  const [focusTs, setFocusTs] = useState<number | null>(null);

  const corr = useMemo(() => tempCorrelations(readings), [readings]);
  const spikes = useMemo(() => detectSpikes(readings), [readings]);
  const pairs = useMemo(() => pairAgreements(readings), [readings]);
  const disturbances = useMemo(() => classifyDisturbances(readings), [readings]);

  // Live status rolled into a diag level for the overall badge.
  const liveDiag: DiagLevel = useMemo(() => {
    if (!latest) return "green";
    const levels = [
      ...MQ_CHANNELS.map((c) => statusToDiag(mqStatus(latest[c.comp]))),
      statusToDiag(co2Status(latest.co2_ppm)),
      statusToDiag(tempStatus(latest.temp_c)),
      statusToDiag(humidityStatus(latest.humidity_pct)),
    ];
    return worst(...levels);
  }, [latest]);

  const health = useMemo(
    () => overallHealth(liveDiag, corr, spikes, pairs, disturbances),
    [liveDiag, corr, spikes, pairs, disturbances]
  );

  const chartData = useMemo(
    () =>
      readings.map((r) => {
        const row: Record<string, number> = { ts: r.ts };
        for (const ch of MQ_CHANNELS) row[ch.id] = r[ch.comp];
        return row;
      }),
    [readings]
  );

  const jumpTo = (ts: number) => {
    setFocusTs(ts);
    chartRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Quality & Diagnostics"
        subtitle="Compensation health · uncaught spikes · disturbance classification"
        right={<RangePicker valueMs={rangeMs} onChange={setRangeMs} />}
      />

      {/* Overall health */}
      <div className="panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-4">
          <HealthBadge level={health.level} />
          <div className="text-sm text-slate-400">
            <div className="font-medium text-slate-300">Overall data health</div>
            <div className="text-xs text-slate-500">
              Worst-of rollup across all checks below · {loading ? "loading…" : `${readings.length} pts in window`}
            </div>
          </div>
        </div>
        <ul className="max-w-md space-y-0.5 text-xs text-slate-400">
          {health.reasons.slice(0, 4).map((r, i) => (
            <li key={i} className="flex gap-1.5">
              <span style={{ color: LEVEL_COLOR[health.level] }}>·</span>
              {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Disturbance classifier */}
      <section className="space-y-3">
        <SectionTitle
          title="Disturbance classifier"
          hint="Distinguishes thermal drift · environmental disturbance · sensor fault"
        />
        {disturbances.length === 0 ? (
          <div className="panel flex items-center gap-3 p-4 text-sm text-slate-400">
            <DiagIcon level="green" size={13} />
            No active disturbance detected in this window — readings look settled.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {disturbances.map((d, i) => (
              <motion.div
                key={d.kind + i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="panel p-4"
                style={{ boxShadow: `inset 0 0 0 1px ${LEVEL_COLOR[d.level]}33` }}
              >
                <div className="mb-1.5 flex items-center gap-2" style={{ color: LEVEL_COLOR[d.level] }}>
                  <DiagIcon level={d.level} size={12} />
                  <span className="text-sm font-semibold">{d.title}</span>
                </div>
                <p className="text-xs leading-relaxed text-slate-400">{d.detail}</p>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Temperature correlation */}
        <section className="space-y-3">
          <SectionTitle
            title="Temperature coupling (post-compensation)"
            hint="Low is good. High |r| is now the alarm — compensation may need refitting."
          />
          <div className="panel divide-y divide-white/[0.04] p-1">
            {corr.map((c) => (
              <div key={c.channelId} className="p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">{c.label}</span>
                  <span
                    className="tnum text-sm font-semibold"
                    style={{ color: LEVEL_COLOR[c.level] }}
                  >
                    r = {Number.isFinite(c.r) ? c.r.toFixed(2) : "—"}
                  </span>
                </div>
                <CorrelationBar r={c.r} level={c.level} />
                <p className="mt-1.5 text-xs text-slate-500">{c.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Sensor-pair agreement */}
        <section className="space-y-3">
          <SectionTitle
            title="Sensor-pair agreement"
            hint="Sibling comp ratio over time — divergence flags a possible single-sensor fault."
          />
          <div className="space-y-3">
            {pairs.map((p) => (
              <div key={p.sensor} className="panel p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">
                    {p.sensor} · {p.aLabel} / {p.bLabel}
                  </span>
                  <span
                    className="tnum text-sm font-semibold"
                    style={{ color: LEVEL_COLOR[p.level] }}
                  >
                    {Number.isFinite(p.ratio) ? p.ratio.toFixed(3) : "—"}
                  </span>
                </div>
                <div className="h-[70px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={p.series} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                      <ReferenceArea
                        y1={1 - PAIR_RATIO.amberDelta}
                        y2={1 + PAIR_RATIO.amberDelta}
                        fill="#34d399"
                        fillOpacity={0.06}
                      />
                      <ReferenceLine y={1} stroke="#475569" strokeDasharray="2 3" />
                      <XAxis dataKey="ts" hide type="number" domain={["dataMin", "dataMax"]} />
                      <YAxis
                        domain={[1 - PAIR_RATIO.faultDelta * 1.5, 1 + PAIR_RATIO.faultDelta * 1.5]}
                        tick={{ fontSize: 9, fill: "#64748b" }}
                        width={36}
                      />
                      <Line
                        type="monotone"
                        dataKey="ratio"
                        stroke={LEVEL_COLOR[p.level]}
                        strokeWidth={1.6}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-xs text-slate-500">{p.note}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Uncaught spike detector */}
      <section className="space-y-3">
        <SectionTitle
          title="Uncaught spike detector"
          hint={`|Δ| > ${5}× rolling-median Δ on compensated channels — excludes rows the firmware already flagged.`}
        />
        <div className="panel p-4">
          {spikes.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <DiagIcon level="green" size={13} /> No uncaught spikes in this window.
            </div>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-auto pr-1">
              {spikes.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-lg bg-ink-850/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="text-drift">
                      <SpikeIcon size={14} />
                    </span>
                    <span className="font-medium text-slate-200">{s.label}</span>
                    <span className="tnum text-slate-500">{dateTime(s.ts)}</span>
                    <span className="tnum text-xs text-slate-600">
                      Δ {fmt(s.delta, 3)} ({s.ratio.toFixed(1)}× median)
                    </span>
                  </div>
                  <button
                    onClick={() => jumpTo(s.ts)}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-signal hover:bg-signal/10"
                  >
                    <JumpIcon size={12} /> view on chart
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Inline comp chart for jump-to */}
      <section ref={chartRef} className="space-y-3">
        <SectionTitle title="Compensated channels" hint="Reference window for the flags above." />
        <div className="panel p-4">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="#1d2a3d" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  tickFormatter={(t) => axisTime(t, rangeMs)}
                  stroke="#475569"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  minTickGap={48}
                />
                <YAxis
                  stroke="#475569"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  width={50}
                  tickFormatter={(v) => fmt(v, 2)}
                  domain={["auto", "auto"]}
                />
                <Tooltip content={<CompTooltip />} />
                {spikes.map((s, i) => (
                  <ReferenceLine
                    key={i}
                    x={s.ts}
                    stroke="#fbbf24"
                    strokeOpacity={0.4}
                    strokeDasharray="3 3"
                  />
                ))}
                {focusTs != null && (
                  <ReferenceLine x={focusTs} stroke="#38e8c8" strokeWidth={1.5} />
                )}
                {MQ_CHANNELS.map((ch) => (
                  <Line
                    key={ch.id}
                    type="monotone"
                    dataKey={ch.id}
                    name={ch.label}
                    stroke={ch.color}
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[0.65rem] text-slate-600">Volts (compensated). Amber lines = uncaught spikes; teal = selected.</p>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function CorrelationBar({ r, level }: { r: number; level: DiagLevel }) {
  const pct = Number.isFinite(r) ? Math.min(Math.abs(r), 1) * 100 : 0;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-ink-700">
      {/* threshold ticks at 0.4 and 0.7 */}
      <div className="absolute inset-y-0" style={{ left: `${CORRELATION.greenBelow * 100}%`, width: 1, background: "#ffffff22" }} />
      <div className="absolute inset-y-0" style={{ left: `${CORRELATION.amberBelow * 100}%`, width: 1, background: "#ffffff22" }} />
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: LEVEL_COLOR[level] }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

function CompTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-ink-900/95 px-3 py-2 text-xs shadow-panel backdrop-blur">
      <div className="mb-1 font-medium text-slate-300">{label ? clockTime(label) : ""}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="tnum text-slate-200">{fmt(p.value, 3)} V</span>
        </div>
      ))}
    </div>
  );
}
