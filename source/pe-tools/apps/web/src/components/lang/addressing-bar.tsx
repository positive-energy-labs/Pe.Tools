/**
 * ADDRESSING BAR — the ONE head rail (ruled 2026-08-16, R11; families audit #11).
 *
 * CONSUMERS: /family (the reference — its promoted head is where the shape was proven);
 * /families and /takeoffs adopt during their route passes. Three surfaces hand-rolled this
 * rail in three idioms before it existed; that convergence is the evidence for the shape.
 *
 * THE FIVE-SLOT STANDING RULE — this order, and nothing else may live on the rail:
 *   1 `name`     the route's name, as chrome: neutral ink, never a meaning role.
 *   2 `sentence` the addressing sentence — clickable nouns only (document · entity · world);
 *                the commit receipt replaces it briefly and relaxes back (the Sentence
 *                component owns that behaviour — SURFACE-PHILOSOPHY §4).
 *   3 `facts`    machine-measured facts as FactChips, in rank order (freshness → dirtiness).
 *   4 `verb`     THE one verb whose blast radius is the whole page — the only blue on the row.
 *   5 `seam`     the fixture/seam chip, right-aligned, saying what would replace the lane.
 *
 * A verb that acts on ONE pane belongs in that pane's action strip. A fact about ONE row
 * belongs beside the row. Anything that does not fit these slots is evidence the head is
 * being asked to carry something with a better home. Under compression, identity outranks
 * controls: the rail wraps rather than shrinking the sentence to a sliver.
 */
import { tv } from "#/lib/tv";

import "./lang.css";

export const addressingBarRecipe = tv({
  slots: {
    base: "flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2",
    name: "t-small t-upper tracking-[0.3em]",
    seam: "ml-auto",
  },
});

export function AddressingBar({
  name,
  sentence,
  facts,
  verb,
  advisory,
  seam,
}: {
  /** The route's name — rendered as quiet tracked chrome. */
  name: string;
  /** The addressing sentence (receipt behaviour included — see `components/sentence`). */
  sentence: React.ReactNode;
  /** FactChips, rank-ordered. */
  facts?: React.ReactNode;
  /** The one page-blast verb. One. */
  verb?: React.ReactNode;
  /** An advisory outcome that must ride the head (rare — prefer the owning pane). */
  advisory?: React.ReactNode;
  /** The fixture/seam chip. The component right-aligns it. */
  seam?: React.ReactNode;
}) {
  const { base, name: nameSlot, seam: seamSlot } = addressingBarRecipe();
  return (
    <header className={base()}>
      <span className={nameSlot()}>{name}</span>
      {sentence}
      {facts}
      {verb}
      {advisory}
      {seam != null ? <span className={seamSlot()}>{seam}</span> : null}
    </header>
  );
}
