/**
 * What a verb did, after it did it: coloured mono text spending existing meaning roles (busy ink-2,
 * receipt done, refused alarm, advisory ink-2, error caution + squiggle). Never wrap a lane of
 * these in an `ArtifactFrame`; it reports on a machine-operated object, it is not one.
 */
import { Ban, Check, Info, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";

import { tv } from "@pe/kit/lib/tv";

import "@pe/kit/lang/lang.css";

export const outcomeLineRecipe = tv({
  slots: {
    base: "grid grid-cols-[14px_minmax(0,auto)_minmax(0,1fr)] items-baseline gap-[7px] py-0.5 face-mono t-small tracking-[0.02em] [&>svg]:size-[11px] [&>svg]:self-center",
    icon: "",
    label: "",
    says: "overflow-hidden text-ellipsis whitespace-nowrap t-small t-upper text-ink-2 italic",
  },
  variants: {
    state: {
      busy: { base: "text-ink-2", icon: "animate-spin" },
      receipt: { base: "" },
      refused: { base: "" },
      advisory: { base: "text-ink-2" },
      error: {
        base: "",
        label: "decoration-caution underline decoration-wavy underline-offset-3",
      },
    },
  },
});

export type OutcomeKind = "busy" | "receipt" | "refused" | "advisory" | "error";

const OUTCOME_TONE: Partial<Record<OutcomeKind, "done" | "alarm" | "caution">> = {
  receipt: "done",
  refused: "alarm",
  error: "caution",
};

const OUTCOME_ICON: Record<OutcomeKind, LucideIcon> = {
  busy: LoaderCircle,
  receipt: Check,
  refused: Ban,
  advisory: Info,
  error: TriangleAlert,
};

interface OutcomeLineProps {
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
    <div className={slots.base()} data-kind={kind} data-tone={OUTCOME_TONE[kind]}>
      <Icon className={slots.icon()} />
      <span className={slots.label()}>{label}</span>
      {says != null ? <span className={slots.says()}>{says}</span> : <span />}
    </div>
  );
}
