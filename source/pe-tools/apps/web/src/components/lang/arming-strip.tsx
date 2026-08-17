/**
 * ARMING STRIP — the ceremony surface for a write that leaves the page.
 *
 * CONSUMER: /parameter-links (fit reviews, ruled 2026-08-16 — the first shipping consumer:
 * its preview→stale→apply gate IS this lifecycle, `refused`'s re-plan = preview). The family
 * apply verb is next. SURFACE-PHILOSOPHY §3 has been owed this strip since the honesty rules
 * were written (reason supplied before it arms · explicit identity · plan hash · drift
 * refusal · receipt).
 *
 * RULINGS EMBODIED (docs/features/design-lang/CLEANROOM.md):
 * - ROUND 1's SECOND MECHANICAL FINDING: **only variant e's arming strip read as ceremony rather
 *   than "just another component"**, and that was attributed to BORDER SCARCITY — a tinted
 *   ground plus one edge, inside the artifact frame, doing what an outline box could not. This
 *   is the cell grammar at its largest scale: same fill-separates-not-borders move.
 * - THE STRIP CARRIES STATE, so it KEEPS its frame under the border budget. It draws its own
 *   `ArtifactFrame`; do not wrap it in a second one.
 * - `--r-on` IS RE-DECLARED to the strip's own tinted fill (lang.css), which is what gives the
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
 * no link from the verb it arms, and no link from a refusal to a fresh plan hash (CLEANROOM,
 * "state-model gaps that block grammar work"). The consequence is visible and stated on the
 * surface rather than hidden: the strip cannot say how stale its own plan is, which is the one
 * fact that decides whether to press it. Upgrade path: the arming record grows `armedAt`,
 * `armedBy` and `supersededBy`, then this signature takes them and the caveat line is deleted.
 */
import { RefreshCw, Upload } from "lucide-react";

import { ArtifactFrame } from "./artifact-frame";
import { FactChip } from "./chip";
import { Verb } from "./verb";

import "./lang.css";

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
  className?: string;
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
  className,
}: ArmingStripProps) {
  if (state.phase === "refused") {
    return (
      <ArtifactFrame className={className}>
        <div className="dl-strip" data-phase="refused">
          <div className="dl-strip-line">
            <span className="dl-tag dl-tag-phase">refused</span>
            <span className="dl-strip-verb">{verb}</span>
          </div>
          <p className="dl-strip-refusal">{state.refusal}</p>
          <div className="dl-strip-controls">
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
  return (
    <ArtifactFrame className={className}>
      <div className="dl-strip" data-phase={armed ? "armed" : "unarmed"}>
        <div className="dl-strip-line">
          <span className="dl-tag dl-tag-phase">{armed ? "armed" : "unarmed"}</span>
          <span className="dl-strip-verb">{verb}</span>
          <span className="dl-strip-target">{target}</span>
          <FactChip title="The plan this write was made against.">plan {planHash}</FactChip>
          <FactChip title="Parameters this write will touch, counted from the plan.">
            {count} params
          </FactChip>
        </div>

        <input
          className="dl-strip-reason-input"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={REASON_PLACEHOLDER}
          aria-label="reason for this write"
        />

        <div className="dl-strip-controls">
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
          {armed ? <span className="dl-tag">armed against a plan of unknown age</span> : null}
        </div>
      </div>
    </ArtifactFrame>
  );
}
