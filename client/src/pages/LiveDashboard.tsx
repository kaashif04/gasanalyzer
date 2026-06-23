import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveData } from "../context/LiveDataContext";
import { useUnits } from "../context/UnitContext";
import { useBaselineHistory } from "../hooks/useBaselineHistory";
import {
  CALIBRATED_RANGE,
  ENV_COLORS,
  MQ_CHANNELS,
  NOISE_FLOOR_GATE,
  NOISE_FLOOR_V,
} from "../lib/constants";
import { Reading } from "../lib/types";
import {
  convertCo2,
  convertMq,
  isEstimatedUnit,
  mqPrecision,
  UNIT_META,
} from "../lib/units";
import {
  co2Status,
  humidityStatus,
  isWithinCalibratedRange,
  mqStatus,
  tempStatus,
} from "../lib/status";
import { computeBaseline, BaselineResult } from "../lib/baseline";
import SensorCard, {
  SensorCardBaseline,
  SensorCardModel,
} from "../components/dashboard/SensorCard";
import { OfflineIcon } from "../components/common/icons";
import { ago, fmt } from "../lib/format";

/** Converts a raw-unit BaselineResult (volts for MQ, ppm for CO2) into the
 *  display-unit form SensorCard expects, applying the SAME conversion to both
 *  the baseline and the live value (correct for nonlinear ppm/% conversions,
 *  rather than converting a raw-unit delta directly).
 *
 *  `noiseFloorV` (volts — only meaningful for MQ comp channels, from a
 *  sealed-chamber baseline measurement) gates the delta: a change smaller
 *  than NOISE_FLOOR_GATE × that floor is the channel's own noise, not a
 *  confirmed move, so it's reported as `withinNoiseFloor` rather than a
 *  confident directional delta. Compared in RAW units (volts), before any
 *  ppm/% conversion, since that's the unit the measured floor is in. */
function toCardBaseline(
  raw: BaselineResult,
  liveRawValue: number,
  convert: (v: number) => number,
  noiseFloorV?: number
): SensorCardBaseline {
  if (!raw.available) {
    return {
      available: false,
      value: NaN,
      delta: NaN,
      deltaPct: null,
      stableDurationMs: 0,
      isAtBaseline: false,
      withinNoiseFloor: false,
    };
  }
  const baselineDisplay = convert(raw.baselineValue);
  const liveDisplay = convert(liveRawValue);
  const delta = liveDisplay - baselineDisplay;
  const deltaPct =
    Math.abs(baselineDisplay) > 1e-6 ? (delta / Math.abs(baselineDisplay)) * 100 : null;
  const rawDelta = Math.abs(liveRawValue - raw.baselineValue);
  const withinNoiseFloor =
    noiseFloorV != null && rawDelta < noiseFloorV * NOISE_FLOOR_GATE;
  return {
    available: true,
    value: baselineDisplay,
    delta,
    deltaPct,
    stableDurationMs: raw.stableDurationMs,
    isAtBaseline: raw.isAtBaseline,
    withinNoiseFloor,
  };
}

/** Last hour of values for one accessor, NaN-tolerant. */
function spark(history: Reading[], pick: (r: Reading) => number): number[] {
  return history.slice(-120).map(pick);
}

function Co2UnitToggle() {
  const { co2Unit, setCo2Unit } = useUnits();
  return (
    <div className="flex overflow-hidden rounded-md border border-white/[0.08] text-[0.62rem]">
      {(["ppm", "percent"] as const).map((u) => (
        <button
          key={u}
          onClick={() => setCo2Unit(u)}
          className={`px-1.5 py-0.5 font-medium transition-colors ${
            co2Unit === u
              ? "bg-drift/20 text-drift"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {u === "ppm" ? "ppm" : "%"}
        </button>
      ))}
    </div>
  );
}

export default function LiveDashboard() {
  const { latest, history1h, isStale, rowAgeMs, freshTick, meta, connected } =
    useLiveData();
  const { unit, co2Unit, showRaw } = useUnits();
  const { readings: baselineHistory } = useBaselineHistory();

  const baselines = useMemo(() => {
    const map: Record<string, BaselineResult> = {};
    for (const ch of MQ_CHANNELS) {
      map[ch.id] = computeBaseline(
        baselineHistory.map((r) => ({ ts: r.ts, value: r[ch.comp] }))
      );
    }
    map.co2 = computeBaseline(baselineHistory.map((r) => ({ ts: r.ts, value: r.co2_ppm })));
    return map;
  }, [baselineHistory]);

  const mqCards = useMemo<SensorCardModel[]>(() => {
    if (!latest) return [];
    const suffix = UNIT_META[unit].mqSuffix;
    const dec = mqPrecision(unit);
    const est = isEstimatedUnit(unit);
    return MQ_CHANNELS.map((ch) => ({
      key: ch.id,
      title: ch.label,
      subLabel: showRaw
        ? `${ch.sensor} · compensated + raw`
        : `${ch.sensor} · compensated`,
      status: mqStatus(latest[ch.comp]),
      value: convertMq(latest[ch.comp], ch.sensor, unit),
      decimals: dec,
      unitSuffix: suffix,
      color: ch.color,
      spark: spark(history1h, (r) => convertMq(r[ch.comp], ch.sensor, unit)),
      secondarySpark: showRaw
        ? spark(history1h, (r) => convertMq(r[ch.raw], ch.sensor, unit))
        : undefined,
      secondaryNote: showRaw ? "raw (uncompensated)" : undefined,
      estimated: est,
      spikeFiltered: latest.spike_flag === 1,
      baseline: toCardBaseline(
        baselines[ch.id],
        latest[ch.comp],
        (v) => convertMq(v, ch.sensor, unit),
        NOISE_FLOOR_V[ch.id]
      ),
    }));
  }, [latest, history1h, unit, showRaw, baselines]);

  const envCards = useMemo<SensorCardModel[]>(() => {
    if (!latest) return [];
    const co2Other: "ppm" | "percent" = co2Unit === "percent" ? "ppm" : "percent";
    const co2OtherValue = convertCo2(latest.co2_ppm, co2Other);
    return [
      {
        key: "co2",
        title: "CO₂",
        subLabel: "non-dispersive IR",
        status: co2Status(latest.co2_ppm),
        value: convertCo2(latest.co2_ppm, co2Unit),
        decimals: co2Unit === "percent" ? 3 : 0,
        unitSuffix: co2Unit === "percent" ? "%" : "ppm",
        valueNote: `≈ ${fmt(co2OtherValue, co2Other === "percent" ? 3 : 0)} ${
          co2Other === "percent" ? "%" : "ppm"
        }`,
        color: ENV_COLORS.co2,
        spark: spark(history1h, (r) => convertCo2(r.co2_ppm, co2Unit)),
        spikeFiltered: latest.spike_flag === 1,
        titleAccessory: <Co2UnitToggle />,
        baseline: toCardBaseline(baselines.co2, latest.co2_ppm, (v) => convertCo2(v, co2Unit)),
      },
      {
        key: "temp",
        title: "Temperature",
        subLabel: "ambient",
        status: tempStatus(latest.temp_c),
        value: latest.temp_c,
        decimals: 1,
        unitSuffix: "°C",
        color: ENV_COLORS.temp,
        spark: spark(history1h, (r) => r.temp_c),
      },
      {
        key: "humidity",
        title: "Humidity",
        subLabel: "relative",
        status: humidityStatus(latest.humidity_pct),
        value: latest.humidity_pct,
        decimals: 1,
        unitSuffix: "%RH",
        color: ENV_COLORS.humidity,
        spark: spark(history1h, (r) => r.humidity_pct),
      },
    ];
  }, [latest, history1h, co2Unit, baselines]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Dashboard"
        subtitle="Current readings · 1-hour sparklines · compensated by default"
      />

      <AnimatePresence>
        {(isStale || !connected) && latest && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-3 rounded-xl border border-fault/30 bg-fault/10 px-4 py-3 text-sm text-fault"
          >
            <span className="animate-stalepulse">
              <OfflineIcon size={18} />
            </span>
            <div>
              <span className="font-semibold">
                {connected ? "Feed has gone stale." : "Backend unreachable."}
              </span>{" "}
              <span className="text-fault/80">
                {connected
                  ? `No new reading for ${ago(
                      rowAgeMs
                    )} (>90s = 2 missed cycles). The ESP32 may be offline or the sheet isn't updating.`
                  : "Cannot reach the monitor backend. Check that the API server is running."}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {latest && !isWithinCalibratedRange(latest.temp_c, latest.humidity_pct) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-3 rounded-xl border border-drift/30 bg-drift/10 px-4 py-3 text-sm text-drift"
          >
            <span className="text-lg leading-none">⚠</span>
            <div>
              <span className="font-semibold">Outside calibrated compensation range.</span>{" "}
              <span className="text-drift/80">
                The per-channel drift compensation was only validated for{" "}
                {CALIBRATED_RANGE.tempMin}–{CALIBRATED_RANGE.tempMax}°C /{" "}
                {CALIBRATED_RANGE.humidityMin}–{CALIBRATED_RANGE.humidityMax}% RH.
                Current conditions ({fmt(latest.temp_c, 1)}°C, {fmt(latest.humidity_pct, 1)}%RH)
                are outside that range, so compensated readings carry reduced confidence
                right now — not a fault, just an unvalidated condition.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!latest ? (
        <EmptyState mock={meta?.source === "mock"} />
      ) : (
        <>
          <section>
            <h2 className="label-eyebrow mb-3">Gas sensors</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {mqCards.map((m) => (
                <SensorCard key={m.key} model={m} stale={isStale} freshTick={freshTick} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="label-eyebrow mb-3">Environment</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {envCards.map((m) => (
                <SensorCard key={m.key} model={m} stale={isStale} freshTick={freshTick} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function EmptyState({ mock }: { mock?: boolean }) {
  return (
    <div className="panel grid place-items-center px-6 py-16 text-center">
      <div className="mb-3 h-2 w-40 overflow-hidden rounded-full bg-ink-700">
        <div className="h-full w-1/3 animate-sweep bg-signal/60" />
      </div>
      <p className="text-sm text-slate-400">
        Waiting for the first reading{mock ? " (mock feed)" : ""}…
      </p>
      <p className="mt-1 text-xs text-slate-600">
        The backend polls every 30 seconds.
      </p>
    </div>
  );
}
