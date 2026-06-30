import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveData } from "../context/LiveDataContext";
import { useUnits } from "../context/UnitContext";
import { useBaselineHistory } from "../hooks/useBaselineHistory";
import {
  CALIBRATING_PING_STALE_MS,
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
  activeCalibratedRange,
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
import { OfflineIcon, StatusIcon } from "../components/common/icons";
import { ago, calibEpochLabel, clockTime, duration, fmt } from "../lib/format";

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
  const {
    latest,
    history1h,
    isStale,
    isProlongedStale,
    resumeInfo,
    showResumeNotice,
    rowAgeMs,
    freshTick,
    meta,
    connected,
  } = useLiveData();
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

  // Single derived mode drives the banner below — see ResumeInfo in
  // LiveDataContext for how "resumed-clean" vs "resumed-unexplained" is
  // decided (whether the resuming row carried a firmware session_start=1
  // marker), and PROLONGED_STALE_MS/RESUME_NOTICE_MS in constants.ts for the
  // timings that separate "normal power cycle" from "actually concerning".
  type BannerMode =
    | "offline"
    | "calibrating"
    | "resumed-clean"
    | "resumed-unexplained"
    | "prolonged-stale"
    | "stale"
    | "none";

  // Trust "calibration in progress" only while its status ping is itself
  // still fresh — see CALIBRATING_PING_STALE_MS. A stale calibrating=1 row
  // (pings stopped, e.g. WiFi died mid-run) correctly falls through to the
  // normal stale/offline checks below instead of staying falsely calm.
  const isCalibratingFresh =
    latest?.calibrating === 1 && rowAgeMs != null && rowAgeMs < CALIBRATING_PING_STALE_MS;

  const bannerMode: BannerMode = !connected
    ? "offline"
    : isCalibratingFresh
    ? "calibrating"
    : showResumeNotice && resumeInfo
    ? resumeInfo.clean
      ? "resumed-clean"
      : "resumed-unexplained"
    : isProlongedStale
    ? "prolonged-stale"
    : isStale
    ? "stale"
    : "none";

  const BANNER_COPY: Record<
    Exclude<BannerMode, "none">,
    { tone: "fault" | "drift" | "nominal" | "info"; title: string; body: string }
  > = {
    offline: {
      tone: "fault",
      title: "Backend unreachable.",
      body: "Cannot reach the monitor backend. Check that the API server is running.",
    },
    calibrating: {
      tone: "info",
      title: "Calibration in progress.",
      body:
        latest && Number.isFinite(latest.calib_seconds_left)
          ? `The unit is running CALIBRATE mode in clean air — about ${duration(
              latest.calib_seconds_left * 1000
            )} remaining. Normal logging resumes automatically when it finishes.`
          : "The unit is running CALIBRATE mode in clean air. Normal logging resumes automatically when it finishes.",
    },
    "prolonged-stale": {
      tone: "fault",
      title: "Feed has gone stale.",
      body: `No new reading for ${ago(
        rowAgeMs
      )} — too long to be a normal power cycle. Check the ESP32/connection.`,
    },
    stale: {
      tone: "drift",
      title: "No new reading yet.",
      body: `Last seen ${ago(
        rowAgeMs
      )}. Could be a normal power cycle — this will clear on its own once data resumes, or escalate if it continues past 10 minutes.`,
    },
    "resumed-clean": {
      tone: "nominal",
      title: "Was powered off.",
      body: `Resumed at ${clockTime(resumeInfo?.resumedAt ?? Date.now())} after a ${duration(
        resumeInfo?.gapMs ?? 0
      )} gap — firmware reported a fresh boot, consistent with a normal power cycle.`,
    },
    "resumed-unexplained": {
      tone: "fault",
      title: "Feed resumed after an unexplained gap.",
      body: `${duration(
        resumeInfo?.gapMs ?? 0
      )} gap with no boot marker seen on the resuming row — may have dropped out without restarting. Worth checking the device/connection.`,
    },
  };

  const TONE_STYLE: Record<
    "fault" | "drift" | "nominal" | "info",
    { border: string; bg: string; text: string; bodyText: string }
  > = {
    fault: {
      border: "border-fault/30",
      bg: "bg-fault/10",
      text: "text-fault",
      bodyText: "text-fault/80",
    },
    drift: {
      border: "border-drift/30",
      bg: "bg-drift/10",
      text: "text-drift",
      bodyText: "text-drift/80",
    },
    nominal: {
      border: "border-nominal/30",
      bg: "bg-nominal/10",
      text: "text-nominal",
      bodyText: "text-nominal/80",
    },
    info: {
      border: "border-info/30",
      bg: "bg-info/10",
      text: "text-info",
      bodyText: "text-info/80",
    },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Dashboard"
        subtitle="Current readings · 1-hour sparklines · compensated by default"
      />

      <AnimatePresence>
        {bannerMode !== "none" && latest && (
          <motion.div
            key={bannerMode}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
              TONE_STYLE[BANNER_COPY[bannerMode].tone].border
            } ${TONE_STYLE[BANNER_COPY[bannerMode].tone].bg} ${
              TONE_STYLE[BANNER_COPY[bannerMode].tone].text
            }`}
          >
            <span
              className={
                bannerMode === "resumed-clean" || bannerMode === "calibrating"
                  ? ""
                  : "animate-stalepulse"
              }
            >
              {bannerMode === "resumed-clean" ? (
                <StatusIcon level="nominal" size={18} />
              ) : bannerMode === "calibrating" ? (
                <span className="text-lg leading-none" aria-hidden>
                  ⚙
                </span>
              ) : (
                <OfflineIcon size={18} />
              )}
            </span>
            <div>
              <span className="font-semibold">{BANNER_COPY[bannerMode].title}</span>{" "}
              <span className={TONE_STYLE[BANNER_COPY[bannerMode].tone].bodyText}>
                {BANNER_COPY[bannerMode].body}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {latest &&
          // Finite check first: a calibrating=1 status ping (or any other
          // row missing temp/humidity) has NaN here, and NaN fails every
          // comparison — without this guard the range check would always
          // read "outside calibrated range" and show a garbled "(—°C,
          // —%RH)" banner for a row that simply has no reading at all yet.
          Number.isFinite(latest.temp_c) &&
          Number.isFinite(latest.humidity_pct) &&
          !isWithinCalibratedRange(
            latest.temp_c,
            latest.humidity_pct,
            activeCalibratedRange(latest)
          ) && (
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
                  Current conditions ({fmt(latest.temp_c, 1)}°C, {fmt(latest.humidity_pct, 1)}%RH)
                  are outside the range observed during {calibEpochLabel(latest.calib_epoch)} (
                  {fmt(activeCalibratedRange(latest).tempMin, 1)}–
                  {fmt(activeCalibratedRange(latest).tempMax, 1)}°C /{" "}
                  {fmt(activeCalibratedRange(latest).humidityMin, 1)}–
                  {fmt(activeCalibratedRange(latest).humidityMax, 1)}% RH), so compensated
                  readings carry reduced confidence right now — not a fault, just an
                  unvalidated condition. Recalibrating in the current room/conditions
                  (CALIBRATE mode) will refresh this band.
                </span>
              </div>
            </motion.div>
          )}
      </AnimatePresence>

      {!latest ? (
        <EmptyState mock={meta?.source === "mock"} />
      ) : bannerMode === "calibrating" ? (
        // Sensor columns are blank on calibrating=1 status pings (it's not
        // really "no data", it's "not measuring gas right now on purpose") —
        // a grid of blank/NaN cards here would look broken, not informative,
        // so show a dedicated panel instead. Cards return automatically the
        // moment normal logging resumes.
        <CalibratingPanel secondsLeft={latest.calib_seconds_left} />
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

function CalibratingPanel({ secondsLeft }: { secondsLeft: number }) {
  // Cosmetic only — matches the firmware's CALIB_DURATION_MS (45 min) for a
  // sensible progress-bar fill; a firmware-side change to that duration
  // would just make this bar's fill percentage slightly off, nothing breaks.
  const TOTAL_SECONDS = 45 * 60;
  const hasCountdown = Number.isFinite(secondsLeft);
  const progressPct = hasCountdown
    ? Math.max(0, Math.min(100, ((TOTAL_SECONDS - secondsLeft) / TOTAL_SECONDS) * 100))
    : 30;

  return (
    <div className="panel grid place-items-center px-6 py-16 text-center">
      <span className="mb-3 text-3xl" aria-hidden>
        ⚙
      </span>
      <p className="text-sm font-medium text-slate-200">Calibrating in clean air…</p>
      <p className="mt-1 text-xs text-slate-500">
        {hasCountdown
          ? `~${duration(secondsLeft * 1000)} remaining`
          : "Sensor readings are paused until this finishes."}
      </p>
      <div className="mt-4 h-2 w-48 overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full bg-info/70 transition-all duration-1000"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="mt-4 max-w-xs text-xs text-slate-600">
        Live sensor cards return automatically once normal logging resumes.
      </p>
    </div>
  );
}
