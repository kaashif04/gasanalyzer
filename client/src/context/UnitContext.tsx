import {
  createContext,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { Co2Unit } from "../lib/units";
import { Unit } from "../lib/types";

interface UnitState {
  unit: Unit;
  setUnit: (u: Unit) => void;
  co2Unit: Co2Unit;
  setCo2Unit: (u: Co2Unit) => void;
  /** Whether MQ cards/charts overlay the raw (uncompensated) channel too. */
  showRaw: boolean;
  setShowRaw: (v: boolean) => void;
}

const Ctx = createContext<UnitState | null>(null);

/** App-wide unit selection. Lives in component state for the session, exactly
 *  as specified — no persistence layer, resets on a fresh load. */
export function UnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnit] = useState<Unit>("voltage");
  const [co2Unit, setCo2Unit] = useState<Co2Unit>("ppm");
  const [showRaw, setShowRaw] = useState(false);

  const value = useMemo(
    () => ({ unit, setUnit, co2Unit, setCo2Unit, showRaw, setShowRaw }),
    [unit, co2Unit, showRaw]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnits(): UnitState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUnits must be used within UnitProvider");
  return v;
}
