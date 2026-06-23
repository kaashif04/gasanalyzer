import { useEffect, useState } from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import { fmt } from "../../lib/format";

interface Props {
  value: number;
  decimals?: number;
  className?: string;
}

/** A numeric readout that tweens smoothly from its previous value to the new
 *  one — the "alive and measuring" feel. Honors prefers-reduced-motion. */
export default function AnimatedNumber({ value, decimals = 2, className }: Props) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(Number.isFinite(value) ? value : 0);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setDisplay(NaN);
      return;
    }
    if (reduce) {
      setDisplay(value);
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, reduce, mv]);

  return <span className={`tnum ${className ?? ""}`}>{fmt(display, decimals)}</span>;
}
