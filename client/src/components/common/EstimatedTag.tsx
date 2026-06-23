import { ESTIMATED_NOTE } from "../../lib/units";

/** The mandatory "(estimated — datasheet approximation…)" label that must
 *  accompany any MQ value shown in ppm/percent. Compact by default with the
 *  full note in a tooltip; `full` renders the entire sentence inline. */
export default function EstimatedTag({ full = false }: { full?: boolean }) {
  if (full) {
    return (
      <span className="text-[0.7rem] italic text-drift/80">({ESTIMATED_NOTE})</span>
    );
  }
  return (
    <span
      title={ESTIMATED_NOTE}
      className="cursor-help rounded bg-drift/10 px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-drift/90"
    >
      est.
    </span>
  );
}
