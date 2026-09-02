/**
 * ARMING STRIP — the ceremony surface for a write that leaves the page.
 *
 * CONSUMER: /parameter-links (fit reviews, ruled 2026-08-16 — the first shipping consumer:
 * its preview→stale→apply gate IS this lifecycle, `refused`'s re-plan = preview). The family
 * apply verb is next. SURFACE-PHILOSOPHY §3 has been owed this strip since the honesty rules
 * were written (reason supplied before it arms · explicit identity · plan hash · drift
 * refusal · receipt).
 *
 * RULINGS EMBODIED:
 * - ROUND 1's SECOND MECHANICAL FINDING: **only variant e's arming strip read as ceremony rather
 *   than "just another component"**, and that was attributed to BORDER SCARCITY — a tinted
 *   ground plus one edge, inside the artifact frame, doing what an outline box could not. This
 *   is the cell grammar at its largest scale: same fill-separates-not-borders move.
 * - THE STRIP CARRIES STATE, so it KEEPS its frame under the border budget. It draws its own
 *   `ArtifactFrame`; do not wrap it in a second one.
 * - `--pe-on` IS RE-DECLARED to the strip's own tinted fill (design-lang.css), which gives the
 *   act verbs inside a resting shape against the ground they actually stand on. Round 2's note-4
 *   defect was exactly this: `cancel` and `re-plan` mixed against the artifact token computed to
 *   1.006 and 1.026 against their real ground, and in dark `cancel` was literally not there.
 * - THE REASON IS SUPPLIED BEFORE THE VERB ARMS AND STAYS VISIBLE AFTER. An armed strip that
 *   hides its own reason is a button with extra steps.
 * - THE UNARMED STATE (the fixture only ever froze armed and refused — a known limitation, not a
 *   design): the verb is PRESENT and DISABLED-WITH-VISIBLE-REASON until a reason is supplied.
 *   It wears no ceremony colour yet and the firm hairline is its edge — this is a thing that
 *   will be armed, not a thing that is. Arming is therefore driven by the reason itself; there
 *   is no separate "arm" press to forget.
 * - COMMIT IS THE ONLY FILLED BLUE, at every blast radius. Cancel and re-plan are `act`.
 *
 * ponytail: arming has no lifecycle or identity in the state model — no armed-at, no armed-by,
 * no link from the verb it arms, and no link from a refusal to a fresh plan hash. The consequence
 * is visible and stated on the
 * surface rather than hidden: the strip cannot say how stale its own plan is, which is the one
 * fact that decides whether to press it. Upgrade path: the arming record grows `armedAt`,
 * `armedBy` and `supersededBy`, then this signature takes them and the caveat line is deleted.
 */
import { RefreshCw, Upload } from "lucide-react";
import { tv } from "#/lib/tv";

import { ArtifactFrame } from "./artifact-frame";
import { FactChip } from "./chip";
import { Verb } from "./verb";

import "./lang.css";

export const armingStripRecipe = tv({
  slots: {
    base: "flex flex-col gap-[7px] border-l-2 px-[11px] py-[9px]",
    line: "flex flex-wrap items-baseline gap-2",
    phase: "t-label tabular-nums",
    verb: "t-prose font-medium",
    target: "t-label tabular-nums",
    input:
      "w-full border-0 border-l border-line-2 bg-on py-0.5 pr-0 pl-2 t-value text-ink italic outline-none placeholder:text-ink-mute",
    refusal: "m-0 max-w-[72ch] t-value",
    controls: "flex flex-wrap items-center gap-2",
    caveat: "t-label tabular-nums",
  },
  variants: {
    state: {
      unarmed: { base: "border-line-2 on-artifact" },
      armed: {
        base: "border-commit commit-wash-artifact",
        phase: "text-commit",
      },
      refused: {
        base: "border-alarm alarm-wash-artifact",
        phase: "text-alarm",
      },
    },
  },
});

export type ArmingState =
  /** Unarmed → armed, decided by whether a reason has been supplied. */
  | { phase: "arming" }
  /** The plan no longer matches the model. The only way forward is a fresh plan. */
  | { phase: "refused"; refusal: string; onReplan: () => void };

export interface ArmingStripProps {
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
            <span className={slots.phase()}>refused</span>
            <span className={slots.verb()}>{verb}</span>
          </div>
          <p className={slots.refusal()}>{state.refusal}</p>
          <div className={slots.controls()}>
            <Verb
              label="re-plan"
              icon={RefreshCw}
              onClick={state.onReplan}
              reason="Re-reads the model and builds a fresh plan"
            />
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
          <span className={slots.phase()}>{armed ? "armed" : "unarmed"}</span>
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
          <Verb
            tone="commit"
            label={verb}
            icon={Upload}
            onClick={onCommit}
            disabled={!armed}
            reason={
              armed
                ? `Writes ${count} parameters into the live model against plan ${planHash}`
                : "supply a reason above — the verb arms when you do"
            }
          />
          {armed ? (
            <Verb label="cancel" onClick={onCancel} reason="Disarms — nothing is written" />
          ) : null}
          {armed ? (
            <span className={slots.caveat()}>armed against a plan of unknown age</span>
          ) : null}
        </div>
      </div>
    </ArtifactFrame>
  );
}
