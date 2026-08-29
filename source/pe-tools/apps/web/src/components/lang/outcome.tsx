/**
 * OUTCOME LINE — what a verb did, after it did it.
 *
 * CONSUMERS: soon — the families and takeoffs receipts lanes; the design-system exhibit.
 *
 * RULINGS EMBODIED:
 * - OUTCOME RECEIPTS READ AS COLOURED MONO TEXT, not left bars — round 1 measured that vertical
 *   bars were simply not understood.
 * - EVERY KIND REUSES A MEANING ROLE ALREADY IN THE CONTRACT. No outcome gets a hue of its own,
 *   and the mapping is documented once, in design-lang.css, next to the tokens it spends:
 *     busy → ink-2 · receipt → done · refused → alarm · dropped → ink-mute (+italic) ·
 *     advisory → ink-2 · partial → caution · error → caution
 *   Two of those are arguments, not conveniences: a plan-hash REFUSAL is the model disagreeing,
 *   so it earns the one alarm; a busy bridge is NOT the model disagreeing, so an ERROR gets
 *   caution instead.
 * - BOLD STAYS RESERVED FOR UNSAVED. Outcomes take their punch from colour, the icon, and the
 *   artifact frame they sit near — never from the type axis (round-2 scoping ruling).
 * - b's DONATION, under c's axis law: `partial` and `error` wear the squiggly-under — the SAME
 *   decoration family the cells use — which is why they read as unfinished without weight; and
 *   `dropped` goes italic and muted, because it never happened.
 * - BORDER BUDGET: an outcomes lane is PLAIN CONTENT. It reports on a machine-operated object;
 *   it is not one. Never wrap these in an `ArtifactFrame`.
 *
 * ponytail: an outcome carries no verb, no time, no target and no item list, which means a lane
 * of these cannot say which write produced
 * which receipt, and "4 staged for retry" has nowhere for the 4 to live. No rendering has been
 * ruled for any of it, so no slot is taken here. Upgrade path: the state model grows the link
 * first, then this signature.
 */
import {
  Ban,
  Check,
  CircleOff,
  Info,
  Layers,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { tv } from "#/lib/tv";

import "./lang.css";

export const outcomeLineRecipe = tv({
  slots: {
    base: "grid grid-cols-[14px_minmax(0,auto)_minmax(0,1fr)] items-baseline gap-[7px] py-0.5 face-mono t-value tracking-[0.02em] tabular-nums [&>svg]:size-[11px] [&>svg]:self-center",
    icon: "",
    label: "",
    says: "overflow-hidden text-ellipsis whitespace-nowrap t-label text-ink-2 italic",
  },
  variants: {
    state: {
      busy: { base: "text-ink-2", icon: "animate-spin" },
      receipt: { base: "text-done" },
      refused: { base: "text-alarm" },
      dropped: { base: "text-ink-mute italic" },
      advisory: { base: "text-ink-2" },
      partial: {
        base: "text-caution",
        label: "decoration-caution underline decoration-wavy underline-offset-3",
      },
      error: {
        base: "text-caution",
        label: "decoration-caution underline decoration-wavy underline-offset-3",
      },
    },
  },
});

export type OutcomeKind =
  | "busy"
  | "receipt"
  | "refused"
  | "dropped"
  | "advisory"
  | "partial"
  | "error";

const OUTCOME_ICON: Record<OutcomeKind, LucideIcon> = {
  busy: LoaderCircle,
  receipt: Check,
  refused: Ban,
  dropped: CircleOff,
  advisory: Info,
  partial: Layers,
  error: TriangleAlert,
};

export interface OutcomeLineProps {
  kind: OutcomeKind;
  /** What happened, in machine terms — mono, tabular, coloured by kind. */
  label: string;
  /** What it means, in a person's terms. Italic, secondary, clamped to one line. */
  says?: string;
}

export function OutcomeLine({ kind, label, says }: OutcomeLineProps) {
  const Icon = OUTCOME_ICON[kind];
  const slots = outcomeLineRecipe({ state: kind });
  return (
    <div className={slots.base()} data-kind={kind}>
      <Icon className={slots.icon()} />
      <span className={slots.label()}>{label}</span>
      {says != null ? <span className={slots.says()}>{says}</span> : <span />}
    </div>
  );
}
