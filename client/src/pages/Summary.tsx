import { useMemo, useState } from "react";
import { useHistory } from "../hooks/useHistory";
import { computeRunSummary, summaryToCsv, SUMMARY_FINAL_WINDOW_MS } from "../lib/summary";
import { lastContinuousSegment } from "../lib/diagnostics";
import { calibEpochLabel } from "../lib/format";
import { fmt, dateTime, duration } from "../lib/format";
import { PageHeader } from "./LiveDashboard";

function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Date.now() : t;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Summary() {
  const [now] = useState(() => Date.now());
  const [from, setFrom] = useState(now - 3 * 3_600_000);
  const [to, setTo] = useState(now);
  const [hasMarker, setHasMarker] = useState(false);
  const [markerTs, setMarkerTs] = useState(now - 1 * 3_600_000);

  const { readings, loading } = useHistory(from, to, 0);

  const trimmedCount = useMemo(() => {
    const seg = lastContinuousSegment(readings);
    return readings.length - seg.length;
  }, [readings]);

  const summary = useMemo(() => {
    const seg = lastContinuousSegment(readings);
    return computeRunSummary(seg, hasMarker ? markerTs : null);
  }, [readings, hasMarker, markerTs]);

  const handleDownload = () => {
    if (!summary) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsv(summaryToCsv(summary), `biogas_summary_${stamp}.csv`);
  };

  const DeltaCell = ({ v, decimals = 4 }: { v: number; decimals?: number }) => {
    if (!Number.isFinite(v)) return <span className="text-slate-600">—</span>;
    const color = v > 0 ? "text-fault" : v < 0 ? "text-info" : "text-slate-400";
    return (
      <span className={`tnum font-medium ${color}`}>
        {v > 0 ? "+" : ""}
        {fmt(v, decimals)}
      </span>
    );
  };
  const NumCell = ({ v, decimals = 4 }: { v: number; decimals?: number }) =>
    Number.isFinite(v) ? (
      <span className="tnum">{fmt(v, decimals)}</span>
    ) : (
      <span className="text-slate-600">—</span>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Run Summary"
        subtitle="Control-vs-final comparison table for regression against a reference instrument"
      />

      {/* Range + marker config */}
      <div className="panel space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="label-eyebrow">Run start</span>
            <input
              type="datetime-local"
              value={toLocalInput(from)}
              onChange={(e) => setFrom(fromLocalInput(e.target.value))}
              className="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-signal/50"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="label-eyebrow">Run end</span>
            <input
              type="datetime-local"
              value={toLocalInput(to)}
              onChange={(e) => setTo(fromLocalInput(e.target.value))}
              className="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-signal/50"
            />
          </label>
        </div>

        <div className="flex items-start gap-3 rounded-xl bg-ink-850/60 p-3">
          <input
            type="checkbox"
            id="has-marker"
            checked={hasMarker}
            onChange={(e) => setHasMarker(e.target.checked)}
            className="mt-1 accent-signal"
          />
          <div className="flex-1">
            <label htmlFor="has-marker" className="cursor-pointer text-sm font-medium text-slate-200">
              Mark when gas was introduced
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              Split the run into a control phase (before) and gas-exposure phase (after). Without
              this, the first 10% of the range is used as the control baseline.
            </p>
            {hasMarker && (
              <input
                type="datetime-local"
                value={toLocalInput(markerTs)}
                onChange={(e) => setMarkerTs(fromLocalInput(e.target.value))}
                className="mt-2 w-full rounded-lg border border-drift/40 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-drift/70"
              />
            )}
          </div>
        </div>
      </div>

      {/* Gap warning */}
      {trimmedCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
          <span>⏱</span>
          <span className="text-info/80">
            Your selected range includes a power-off gap — {trimmedCount} earlier row
            {trimmedCount === 1 ? "" : "s"} excluded. Summary is computed on the most recent
            continuous run only.
          </span>
        </div>
      )}

      {loading ? (
        <div className="panel grid place-items-center px-6 py-12 text-sm text-slate-500">
          Loading…
        </div>
      ) : !summary ? (
        <div className="panel grid place-items-center px-6 py-12 text-sm text-slate-500">
          No data found for the selected range.
        </div>
      ) : (
        <>
          {/* Metadata strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-850/60 px-4 py-3 text-xs text-slate-500">
            <div className="flex flex-wrap gap-4">
              <span>
                <span className="text-slate-400">Range</span>{" "}
                {dateTime(summary.rangeStart)} → {dateTime(summary.rangeEnd)}
              </span>
              <span>
                <span className="text-slate-400">Control ends</span>{" "}
                {dateTime(summary.controlEnd)}
              </span>
              <span>
                <span className="text-slate-400">Final window</span> last{" "}
                {duration(SUMMARY_FINAL_WINDOW_MS)} of range
              </span>
              <span>
                <span className="text-slate-400">{summary.sampleCount} samples</span>
              </span>
            </div>
            {summary.calibEpoch && (
              <span className="text-slate-600">
                Calibration: {calibEpochLabel(summary.calibEpoch)}
              </span>
            )}
          </div>

          {/* Summary table */}
          <div className="panel overflow-x-auto p-1">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {[
                    "Channel",
                    "Unit",
                    "Control (baseline)",
                    `Final (last 5 min)`,
                    "Δ (final − control)",
                    "Min",
                    "Max",
                    "Mean (whole run)",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-[0.65rem] font-medium uppercase tracking-wider text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {summary.channels.map((ch, i) => {
                  const isGasChannel = ch.key.includes("mq");
                  const isComp = ch.key.endsWith("_comp");
                  const isFirst = i === 0;
                  const prevKey = i > 0 ? summary.channels[i - 1].key : null;
                  const groupBreak =
                    isFirst ||
                    (prevKey && (prevKey.startsWith("mq4") !== ch.key.startsWith("mq4") ||
                      prevKey.startsWith("mq8") !== ch.key.startsWith("mq8") ||
                      (prevKey.includes("mq") && !ch.key.includes("mq"))));
                  const dec = ch.unit === "ppm" ? 0 : ch.unit === "°C" || ch.unit === "%RH" ? 2 : 4;
                  return (
                    <tr
                      key={ch.key}
                      className={`hover:bg-white/[0.02] ${
                        !isGasChannel ? "opacity-80" : isComp ? "" : "opacity-60"
                      } ${groupBreak && !isFirst ? "border-t border-white/10" : ""}`}
                    >
                      <td className="px-3 py-2.5 text-slate-200">
                        <span className={isComp ? "font-medium" : ""}>{ch.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">{ch.unit}</td>
                      <td className="px-3 py-2.5">
                        <NumCell v={ch.control} decimals={dec} />
                      </td>
                      <td className="px-3 py-2.5">
                        <NumCell v={ch.final} decimals={dec} />
                      </td>
                      <td className="px-3 py-2.5">
                        <DeltaCell v={ch.delta} decimals={dec} />
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">
                        <NumCell v={ch.min} decimals={dec} />
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">
                        <NumCell v={ch.max} decimals={dec} />
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">
                        <NumCell v={ch.mean} decimals={dec} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Download */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-ink-900 hover:bg-signal-glow"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M4 16h12" />
              </svg>
              Download summary CSV
            </button>
            <span className="text-xs text-slate-500">
              Includes metadata (calibration epoch, range, timestamps) for regression traceability.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
