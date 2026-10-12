/**
 * The ceremony surface for a write that leaves the page. It carries state, so it draws its own
 * `ArtifactFrame` (do not wrap it). The reason is supplied before the verb arms and stays visible;
 * commit is the only filled blue.
 */
import { RefreshCw, Upload } from "lucide-react";
import { tv } from "#/lib/tv";

import { ArtifactFrame } from "./artifact-frame";
import { FactChip } from "./chip";
import { Button } from "./button";

import "./lang.css";

export const armingStripRecipe = tv({
  slots: {
    base: "flex flex-col gap-[7px] border-l-2 px-[11px] py-[9px]",
    line: "flex flex-wrap items-baseline gap-2",
    phase: "t-small t-upper tabular-nums",
    verb: "t-small font-semibold",
    target: "t-small t-upper tabular-nums",
    input:
      "w-full border-0 border-l border-line-2 bg-on py-0.5 pr-0 pl-2 t-small text-ink italic outline-none placeholder:text-ink-mute",
    refusal: "m-0 max-w-[72ch] t-small",
    controls: "flex flex-wrap items-center gap-2",
    caveat: "t-small t-upper tabular-nums",
  },
  variants: {
    state: {
      unarmed: { base: "border-line-2" },
      armed: {
        base: "border-commit commit-wash-artifact",
      },
      refused: {
        base: "border-alarm alarm-wash-artifact",
      },
    },
  },
});

export type ArmingState =
  /** Unarmed → armed, decided by whether a reason has been supplied. */
  | { phase: "arming" }
  /** The plan no longer matches the model. The only way forward is a fresh plan. */
  | { phase: "refused"; refusal: string; onReplan: () => void };

interface ArmingStripProps {
  /** The verb being armed, e.g. "apply to Revit". Shown, and used as the commit label. */
  verb: string;
  /** What the write addresses, e.g. "Overhead Coiling Door 421 · 3 types". */
  target: string;
  /** Parameters this write will touch, counted from the plan. */
  count: number;
  /** The plan this write was made against — the hash a refusal will cite. */
  planHash: string;
  /** Required before the verb arms; empty means unarmed. Stays visible and editable after. */
  reason: string;
  onReasonChange: (reason: string) => void;
  state: ArmingState;
  /** Fires only when armed. */
  onCommit: () => void;
  /** Disarms — nothing is written. */
  onCancel: () => void;
}

const REASON_PLACEHOLDER = "why this write is happening — required before the verb arms";

export function ArmingStrip({
  verb,
  target,
  count,
  planHash,
  reason,
  onReasonChange,
  state,
  onCommit,
  onCancel,
}: ArmingStripProps) {
  if (state.phase === "refused") {
    const slots = armingStripRecipe({ state: "refused" });
    return (
      <ArtifactFrame>
        <div className={slots.base()} data-phase="refused">
          <div className={slots.line()}>
            <span className={slots.phase()} data-tone="alarm">
              refused
            </span>
            <span className={slots.verb()}>{verb}</span>
          </div>
          <p className={slots.refusal()}>{state.refusal}</p>
          <div className={slots.controls()}>
            <Button
              kind="framed"
              label="re-plan"
              icon={RefreshCw}
              onClick={state.onReplan}
              reason="Re-reads the model and builds a fresh plan"
            >
              re-plan
            </Button>
          </div>
        </div>
      </ArtifactFrame>
    );
  }

  const armed = reason.trim().length > 0;
  const slots = armingStripRecipe({ state: armed ? "armed" : "unarmed" });
  return (
    <ArtifactFrame>
      <div className={slots.base()} data-phase={armed ? "armed" : "unarmed"}>
        <div className={slots.line()}>
          <span className={slots.phase()} data-tone={armed ? "commit" : undefined}>
            {armed ? "armed" : "unarmed"}
          </span>
          <span className={slots.verb()}>{verb}</span>
          <span className={slots.target()}>{target}</span>
          <FactChip title="The plan this write was made against.">plan {planHash}</FactChip>
          <FactChip title="Parameters this write will touch, counted from the plan.">
            {count} params
          </FactChip>
        </div>

        <input
          className={slots.input()}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={REASON_PLACEHOLDER}
          aria-label="reason for this write"
        />

        <div className={slots.controls()}>
          <Button
            kind="commit"
            label={verb}
            icon={Upload}
            onClick={onCommit}
            reason={`Writes ${count} parameters into the live model against plan ${planHash}`}
            refusal={armed ? null : "supply a reason above — the verb arms when you do"}
          >
            {verb}
          </Button>
          {armed ? (
            <Button
              kind="framed"
              label="cancel"
              onClick={onCancel}
              reason="Disarms — nothing is written"
            >
              cancel
            </Button>
          ) : null}
          {armed ? (
            <span className={slots.caveat()}>armed against a plan of unknown age</span>
          ) : null}
        </div>
      </div>
    </ArtifactFrame>
  );
}
