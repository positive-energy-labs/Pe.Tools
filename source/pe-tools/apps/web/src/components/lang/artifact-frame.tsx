/**
 * ARTIFACT FRAME — the language's one enclosure.
 *
 * CONSUMERS: the master-table wrapper; pea's chat proposal card; `ArmingStrip` (which draws its
 * own); soon: the addressing sentence.
 *
 * RULINGS EMBODIED:
 * - "Artifact frames enter the base" (round-1 ruling grill): large interactive chunks get a
 *   shared treatment separating them from page content — one ground shift plus one quiet inset
 *   hairline. No radius, no shadow; round 1 ruled that FILLS separate and outline borders do not.
 * - THE BORDER BUDGET (round-2 ruling note 3): **plain content is never enclosed.** A frame is
 *   for a MACHINE-OPERATED OBJECT THAT CARRIES STATE — the table, pea's card, the arming strip,
 *   the sentence. A group of plain controls or receipts (a verb lane, an outcomes lane) sits
 *   directly on the page ground under a quiet head, with nothing around it. Every frame spent on
 *   something with no state to separate makes the four real ones read as less special.
 *   Edge cases left unruled: is a write-verb group an artifact? a bare receipt line?
 *   Both currently answer "no" — they are plain content.
 * - `--pe-on` PLUMBING: the frame declares the ground its children actually sit on, and the
 *   recessed bands re-declare it again, so every wash the cell grammar mixes lands on the right
 *   ground without any child naming its own container. See base.css.
 */
import { tv } from "#/lib/tv";

import { Rail } from "./rail";

import "./lang.css";

export const artifactFrameRecipe = tv({
  slots: {
    base: "on-artifact inset-ring",
  },
});

export interface ArtifactFrameProps {
  /** Recessed band across the top — the object's name and its machine-measured facts. */
  head?: React.ReactNode;
  headTrail?: React.ReactNode;
  /** Recessed band across the bottom — counts, receipts, and the object's one commit verb. */
  foot?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
}

export function ArtifactFrame({
  head,
  headTrail,
  foot,
  children,
  className,
  label,
}: ArtifactFrameProps) {
  const { base } = artifactFrameRecipe();
  return (
    <div
      className={base({ class: className })}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {head != null ? <Rail ground="recess" lead={head} trail={headTrail} /> : null}
      {children}
      {foot != null ? <Rail ground="recess" lead={foot} /> : null}
    </div>
  );
}
