import { ESTIMATED_NOTE } from "../lib/units";
import { PageHeader } from "./LiveDashboard";

/**
 * Placeholder for the future trained gas-fraction regression model (true
 * CH4%/H2% from IWK-calibrated data). Deliberately distinct — in wording and
 * visual treatment — from the datasheet-approximation ppm/% unit toggle, so
 * nobody mistakes the estimate for the real calibrated output.
 */
export default function Calibrated() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Calibrated Readings"
        subtitle="Pending IWK calibration"
      />

      <div className="panel relative overflow-hidden p-6">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-signal/[0.04] to-transparent" />
        <div className="relative">
          <span className="pill bg-info/10 text-info">
            <span className="h-1.5 w-1.5 rounded-full bg-info" /> Not yet available
          </span>

          <h2 className="mt-4 text-lg font-semibold text-slate-100">
            True CH₄ / H₂ gas-fraction model
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-400">
            This section will surface real methane and hydrogen fractions from a
            regression model trained against IWK reference instrumentation. The
            hooks are in place — it will read the same compensated channels shown
            on the dashboard and add a calibrated, lab-validated output layer.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <PlaceholderReadout label="CH₄ (calibrated)" />
            <PlaceholderReadout label="H₂ (calibrated)" />
          </div>

          <div className="mt-5 rounded-xl border border-drift/20 bg-drift/[0.06] p-4 text-sm text-drift/90">
            <strong className="font-semibold">Not the same as the PPM / % toggle.</strong>{" "}
            <span className="text-drift/70">
              The app-wide unit switch produces a datasheet approximation
              ({ESTIMATED_NOTE}). These calibrated readings will be a trained
              model output validated against lab equipment — a different thing
              entirely. They are kept separate on purpose.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderReadout({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-850/60 p-4">
      <div className="label-eyebrow">{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="tnum text-3xl font-semibold text-slate-700">––.–</span>
        <span className="mb-1 text-sm text-slate-600">%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
        <div className="h-full w-1/4 animate-sweep bg-slate-600/50" />
      </div>
    </div>
  );
}
