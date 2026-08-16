/**
 * STATE CELL — the one grammar, at any scale.
 *
 * CONSUMERS: master-table cells; the trichotomy reviewer (soon); pea's chat proposal card
 * (soon — the card's staged values are this same treatment one scale up); `CellStateKey`, which
 * renders its specimens through this component precisely so the key cannot lie about the table.
 *
 * RULINGS EMBODIED (docs/features/design-lang/CLEANROOM.md):
 * - ROUND 1 WAS WON BY "one cell grammar everywhere" — the chat card's staged values, the table
 *   cells and the arming strip being the same treatment at three scales was named load-bearing.
 *   This component is the first of those three; the other two are built from the same tokens.
 * - THE WEAK ANCHOR (round-1 ruling grill): **cell-BODY treatment is reserved for pea proposals
 *   and uneditable/disabled.** Everything else — drift, freshness, staging — lives at
 *   edges/text/decoration. Variant e's everything-is-a-wash was not adopted.
 * - c's AXIS LAW: ONE decoration family (the squiggle) carries "state of the value", ranked by
 *   colour — drift ▸ stale ▸ unverified. One winner draws; the losers draw nothing. A PLAIN
 *   underline is a CITATION, and it lives on the footline's source name — a different element —
 *   so it can never contend for the squiggle's slot.
 * - ROUND-2 RULING NOTE 1: pea's open proposal keeps BOTH the fold and the unsaved square, in
 *   pea's own ink. The square's presence means "nothing is written yet"; its COLOUR carries
 *   authorship. Your own staged edit gets the same shape in caution, plus bold.
 * - BOLD IS RESERVED FOR UNSAVED, everywhere, always — and only for YOUR unsaved edit, because
 *   pea's cell already owns the body and the wash has said it.
 * - ONE FOOTLINE, ONE LINE, CLAMPED, ranked capReason ▸ note ▸ citation. Stacking these is what
 *   killed variant e's density (round 1 measured a 2.1× row-height spread).
 * - ICONS NEVER GO INSIDE A DATA CELL — they break table ergonomics the moment a value runs long.
 *
 * PRECEDENCE, in order (enforced by cascade in lang.css, not by discipline here):
 *   1 uneditable owns the body · 2 pea's proposal owns it otherwise · 3 the squiggle slot ·
 *   4 unsaved composes on top · 5 citation never contends.
 */
import { cn } from "#/lib/utils";

import "./lang.css";

/** The one squiggle slot. Ranked; exactly one may draw. */
export type Unsettled = "drift" | "stale" | "unverified";

export interface StateCellProps {
  /** The value as shown. Long values are expected — the grammar is built around them. */
  value: React.ReactNode;
  /**
   * What the model currently holds, when it disagrees. Renders as the struck inline ghost token
   * beside the value — drift's second half, at zero row-height cost.
   */
  modelValue?: string;
  /** How old the reading behind the value is. Ranks below `agree` in the squiggle slot. */
  fresh?: "fresh" | "stale" | "unverified";
  /** Whether the model holds the same value. `drift` is the ONE alarm. */
  agree?: "agree" | "drift";
  /** Whose unsaved event, if any, is sitting on this cell. */
  stage?: "clean" | "proposed" | "staged";
  /**
   * Who staged it — pea's square is pea's ink, yours is caution and carries the bold.
   *
   * ponytail: the state model has no author on `staged` (CLEANROOM: "staging has no author",
   * the round's strongest signal — `trichotomy.ts` stores `by` and every consumer discards it).
   * The prop exists because the RENDERING is ruled; callers default to "you" until the model
   * carries the fact. Upgrade path: plumb `staged.by` through the trichotomy payload and drop
   * the default.
   */
  stagedBy?: "pea" | "you";
  /** Whether the cell can be written at all. Anything but `editable` owns the body. */
  cap?: "editable" | "readonly" | "excluded" | "nohome";
  /** Why it refuses edits. Present exactly when `cap` is not `editable`; ranks first on the footline. */
  capReason?: string;
  /** Where the number came from. Renders as the plain-underline citation, last on the footline. */
  grounding?: { doc: string; page: number };
  confidence?: "high" | "low";
  note?: string;
  className?: string;
}

interface CellRead {
  /** The only two things allowed to own the cell BODY. */
  body: "proposed" | "locked" | null;
  /** No real element behind it — the reserved dashed seam edge. */
  seam: boolean;
  /** The one squiggle slot; one winner. */
  unsettled: Unsettled | null;
  /** Your unsaved edit (bold + caution square), pea's (pea square, no bold), or none. */
  unsaved: "you" | "pea" | null;
}

/**
 * The precedence, executed once. Every scale reads state through this, so the card, the table
 * and the key cannot disagree about what a cell is.
 */
function readCell(p: StateCellProps): CellRead {
  const cap = p.cap ?? "editable";
  const locked = cap !== "editable";
  const stage = p.stage ?? "clean";
  return {
    body: locked ? "locked" : stage === "proposed" ? "proposed" : null,
    seam: cap === "nohome",
    unsettled:
      p.agree === "drift"
        ? "drift"
        : p.fresh === "stale"
          ? "stale"
          : p.fresh === "unverified"
            ? "unverified"
            : null,
    // An open proposal is unsaved too, but its square is drawn off `body: "proposed"` — see
    // lang.css. This slot is only for a STAGED value, whose author is the open question.
    unsaved: !locked && stage === "staged" ? (p.stagedBy ?? "you") : null,
  };
}

/**
 * Cell state, in the order attention is owed: fix drift, review the proposal, commit the staged,
 * re-read the stale, check the unverified, leave clean alone, and locked last — nothing to do.
 * A state column with no explicit `sort` orders by this (SURFACE-PHILOSOPHY §1: state columns
 * sort in the order the work happens, not alphabetically).
 */
export const CELL_STATE_ORDER = [
  "drift",
  "proposed",
  "staged",
  "stale",
  "unverified",
  "clean",
  "locked",
] as const;
export type CellStateName = (typeof CELL_STATE_ORDER)[number];

/**
 * The precedence collapsed to one word — the vocabulary a table can facet, count and group by.
 * Executes the same `readCell` as the renderer, so the word and the marks cannot disagree.
 */
export function cellStateLabel(p: StateCellProps): CellStateName {
  const read = readCell(p);
  if (read.body === "locked") return "locked";
  if (read.unsettled === "drift") return "drift";
  if (read.body === "proposed") return "proposed";
  if (read.unsaved != null) return "staged";
  if (read.unsettled != null) return read.unsettled;
  return "clean";
}

export function StateCell(props: StateCellProps) {
  const { value, modelValue, capReason, grounding, confidence, note, className } = props;
  const read = readCell(props);

  // ONE footline, ranked and joined onto a single clamped line rather than stacked.
  const facts: React.ReactNode[] = [];
  if (capReason != null) facts.push(capReason);
  if (note != null) facts.push(confidence != null ? `${confidence} confidence — ${note}` : note);
  // A low confidence with nothing else to say still has to say it; silence would read as high.
  else if (confidence === "low") facts.push("low confidence");
  if (grounding != null)
    facts.push(
      <span className="dl-cite" key="cite">
        {grounding.doc} p.{grounding.page}
      </span>,
    );

  return (
    <span className={cn(className)}>
      <span className="dl-cell-line">
        <span
          className="dl-cell"
          data-body={read.body ?? undefined}
          data-seam={read.seam ? "" : undefined}
          data-unsaved={read.unsaved === "pea" ? "pea" : read.unsaved === "you" ? "" : undefined}
        >
          {read.unsettled != null ? (
            <span className="dl-sq" data-state={read.unsettled}>
              {value}
            </span>
          ) : (
            value
          )}
        </span>
        {read.unsettled === "drift" && modelValue != null ? (
          <span className="dl-ghost" title="the value the model currently holds">
            {modelValue}
          </span>
        ) : null}
      </span>
      {facts.length > 0 ? (
        <span className="dl-foot">
          {facts.map((f, i) => (
            <span key={i}>
              {i > 0 ? " · " : null}
              {f}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
