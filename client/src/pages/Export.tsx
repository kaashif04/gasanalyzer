import { useMemo, useState } from "react";
import { exportUrl } from "../api/client";
import { useHistory } from "../hooks/useHistory";
import { dateTime } from "../lib/format";
import RangePicker, { PRESETS } from "../components/common/RangePicker";
import { PageHeader } from "./LiveDashboard";

/** datetime-local <-> epoch helpers (local time, minute precision). */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Date.now() : t;
}

export default function ExportPage() {
  const now = useMemo(() => Date.now(), []);
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [rangeMs, setRangeMs] = useState(24 * 3_600_000);
  const [from, setFrom] = useState(now - 24 * 3_600_000);
  const [to, setTo] = useState(now);

  const effFrom = mode === "preset" ? now - rangeMs : from;
  const effTo = mode === "preset" ? now : to;

  // Count rows in the chosen window (no refresh — this is a static export view).
  const { readings, loading } = useHistory(effFrom, effTo, 0);

  const href = exportUrl(effFrom, effTo);
  const valid = effTo > effFrom;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Export"
        subtitle="Download a CSV for any range — raw, compensated, and spike_flag columns included"
      />

      <div className="panel space-y-5 p-5">
        <div className="flex gap-2">
          <ModeTab active={mode === "preset"} onClick={() => setMode("preset")}>
            Recent window
          </ModeTab>
          <ModeTab active={mode === "custom"} onClick={() => setMode("custom")}>
            Custom range
          </ModeTab>
        </div>

        {mode === "preset" ? (
          <div className="space-y-2">
            <span className="label-eyebrow">Range</span>
            <RangePicker valueMs={rangeMs} onChange={setRangeMs} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <input
                type="datetime-local"
                value={toLocalInput(from)}
                onChange={(e) => setFrom(fromLocalInput(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-signal/50"
              />
            </Field>
            <Field label="To">
              <input
                type="datetime-local"
                value={toLocalInput(to)}
                onChange={(e) => setTo(fromLocalInput(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-signal/50"
              />
            </Field>
          </div>
        )}

        <div className="rounded-xl bg-ink-850/60 p-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat label="From" value={dateTime(effFrom)} />
            <Stat label="To" value={dateTime(effTo)} />
            <Stat
              label="Rows in range"
              value={loading ? "counting…" : readings.length.toLocaleString()}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={valid ? href : undefined}
            download
            aria-disabled={!valid}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              valid
                ? "bg-signal text-ink-900 hover:bg-signal-glow"
                : "pointer-events-none bg-ink-700 text-slate-500"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M4 16h12" />
            </svg>
            Download CSV
          </a>
          <span className="text-xs text-slate-500">
            Columns: timestamp, *_raw, *_comp, co2_ppm, temp_c, humidity_pct, spike_flag
          </span>
        </div>
      </div>

      <p className="px-1 text-xs leading-relaxed text-slate-600">
        The export streams from the same parsed store the dashboard uses, so the
        CSV matches IWK's source-of-truth column layout exactly — suitable for
        offline analysis and side-by-side calibration comparison.
      </p>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-signal/15 text-signal ring-1 ring-signal/30" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label-eyebrow">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-eyebrow">{label}</div>
      <div className="tnum mt-0.5 text-slate-200">{value}</div>
    </div>
  );
}

export { PRESETS };
