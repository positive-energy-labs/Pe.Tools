import { canonicalRouteInput, type TrichotomyCellLike } from "@pe/agent-contracts";
import type React from "react";

/** The one squiggle slot. Ranked; exactly one may draw. `never` is NOT here on purpose —
 * nothing exists to distrust, so it draws no squiggle (ruled 2026-08-16, consolidation batch). */
export type Unsettled = "drift" | "stale" | "unverified";

export interface StateCellProps {
  /** The value as shown. Long values are expected — the grammar is built around them. */
  value: React.ReactNode;
  /**
   * What the model currently holds, when it disagrees. Renders as the struck inline ghost token
   * beside the value — drift's second half, at zero row-height cost.
   */
  modelValue?: string;
  /**
   * The epistemic ladder — how much do we know about this value (ruled 2026-08-16):
   * `fresh` checked recently · `stale` checked long ago · `unverified` a value exists but was
   * never checked · `never` nothing was ever attempted — no reading, no value. The first three
   * rank in the squiggle slot below `agree`; `never` draws NO squiggle at all (there is nothing
   * to distrust) — the value slot renders muted. "Not started is a state, not a zero"
   * (SURFACE-PHILOSOPHY §1) finally has its rung; three routes were borrowing `unverified`.
   */
  fresh?: "fresh" | "stale" | "unverified" | "never";
  /** Whether the model holds the same value. `drift` is the ONE alarm. */
  agree?: "agree" | "drift";
  /** Whose unsaved event, if any, is sitting on this cell. */
  stage?: "clean" | "proposed" | "staged";
  /**
   * Who staged it — pea's square is pea's ink, yours is caution and carries the bold.
   * RULED 2026-08-16 (consolidation batch): authorship is a QUALIFIER of staging, not a fifth
   * axis — it only reads when `stage` is not clean. Census tables count four axes + qualifier.
   * `cellFromTrichotomy` derives it from `proposal.by` and the staged value; hand-written
   * callers that have no proposal behind the staging pass "you".
   */
  stagedBy?: "pea" | "you";
  /**
   * THE COUNTER-PROPOSAL (ruled 2026-08-31, review deletion): pea's standing proposed value when
   * it is NOT what the cell shows — proposal and staged both present, values differing. Draws the
   * fold alone (no body wash — the shown value is not pea's) and rides the facts/footline. This
   * is pea's in-cell voice against a staged value; its other channel is chat.
   */
  counterValue?: string;
  /**
   * Whether the cell can be written at all. Anything but `editable` owns the body.
   * RULED 2026-08-31 (proposal-state demiurge): `readonly` and `excluded` were one rendering
   * under two names — they collapse into `locked` and the distinction rides `capReason`, which
   * is the only place it was ever legible. `nohome` stays: it draws the seam.
   */
  cap?: "editable" | "locked" | "nohome";
  /** Why it refuses edits. Present exactly when `cap` is not `editable`; ranks first on the footline. */
  capReason?: string;
  /** Where the number came from. Renders as the plain-underline citation, last on the footline. */
  grounding?: { doc: string; page: number };
  confidence?: "high" | "low";
  note?: string;
  /**
   * ROW SCALE (ruled 2026-08-16, kaitpw): inside a table a cell is ONE CLIPPED LINE — the value
   * plus the zero-footprint marks (full-bleed body wash, squiggle, fold, square). No footline,
   * no inline ghost: prose facts and the model's ghost value live in the table's READOUT BAND
   * (and the title, as the hover shortcut). Fat rows are never allowed; a cell clips rather
   * than expands, so column alignment and row height are uniform by construction. "card"
   * (default) keeps the footline — pea's card and standalone specimens have room for it.
   */
  scale?: "card" | "row";
  /**
   * Where the card-scale footline goes. RULED 2026-08-31 (per-cell grounding): the footline may
   * not wrap a cell to two lines, and the 10px floor forbids shrinking it — so inside a
   * constrained context (a table cell at card scale) it collapses to `hover`, the same `title`
   * the row scale uses. `inline` keeps it where the card has room: pea's chat card, specimens.
   * Row scale is always hover; this only reads at card scale.
   */
  foot?: "inline" | "hover";
  /**
   * THE EDITABLE CELL (ruled 2026-08-16, consolidation batch R8 — families #6, "the strongest
   * finding of the sweep"). Present ⇒ the value slot renders as a caret-safe input; every mark
   * stays OUTSIDE the text box ("do not steal the caret"). Return a string to REFUSE the
   * commit: the cell restores the prior value and shows a dismissible caution note carrying
   * the reason — §3's "restore AND say why, near the cell, without resizing the row". Requires
   * `scale="row"` and a string `value`; `cap` other than editable wins and renders locked.
   */
  onCommit?: (text: string) => string | void;
  /**
   * NUMERIC COMMIT (ruled 2026-08-16, fit reviews #2 — §3's named silent-swallow defect, killed
   * here): present ⇒ the commit path parses per `parseCell` before `onCommit` sees anything. A
   * refused parse (blank, not a number) RETURNS a reason, so the built-in refusal note fires —
   * never a silent restore. Integers truncate, `min` clamps, and `onCommit` receives the
   * normalized text (`fmtNum`, `digits`).
   */
  numeric?: { integer?: boolean; min?: number; digits?: number };
  /** Placeholder for the editable value slot — e.g. an inherited value the cell would take. */
  placeholder?: string;
  /**
   * Locate what this cell describes (ruled 2026-08-16, fit reviews — families #14): a click on
   * the cell BODY when not editing. The marks stay non-focusable and an editable cell's clicks
   * belong to the caret — the input swallows them — so locate never contends with editing.
   *
   * RULED 2026-08-31 (critic verdict 14 — RE-OPENABLE): on an editable cell the input fills the
   * body, so "the body" was a 2px strip of padding and the affordance was effectively unclickable.
   * THE CELL'S MARKS ARE THE LOCATE TARGET: the proposal fold and the unsaved square already
   * render outside the input and already mean "there is something to go look at", so they carry
   * the click. A cell with `onLocate` and NO mark still locates on its body — there is nothing to
   * aim at, but nothing is stolen either.
   */
  onLocate?: () => void;
  /** Cell-to-cell navigation hook (Enter/Tab/arrows). Return true when the move was taken. */
  onNavigate?: (dir: "up" | "down" | "left" | "right") => boolean;
}

/**
 * THE ONE READER (ruled 2026-08-31, proposal-state demiurge). A trichotomy cell —
 * `agent-contracts/src/trichotomy.ts`, proposal → staged → committed — plus the caller's own
 * facts (the shown value, agreement, freshness, capability) becomes `StateCellProps` HERE, so no
 * route re-derives the mapping and no two surfaces can disagree about what a proposal looks like.
 *
 * What the trichotomy does NOT have, on purpose:
 * - no `denied`: a denial CLEARS the proposal upstream and the cell shows the real value again.
 * - no `written`: a commit CLEARS `staged`; saved/unsaved and fresh/stale carry that signal.
 */
/**
 * What a rung WRITES: its value and whether it deletes. Rungs are compared as canonical JSON, never
 * by identity — Work is deserialized, so two equal object values are never the same reference.
 */
const rungPayload = (rung: { value?: unknown; delete?: true }) =>
  canonicalRouteInput({ value: rung.value, delete: rung.delete === true });

/** The default counter word: a string as written, anything else as JSON — never `[object Object]`. */
const showJson = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

export function cellFromTrichotomy(
  cell: Pick<TrichotomyCellLike, "proposal" | "staged">,
  facts: StateCellProps,
  /** The caller's word for a counter-proposed value; domain values are the caller's to format. */
  show: (value: unknown) => string = showJson,
): StateCellProps {
  const { proposal, staged } = cell;
  // Staging is the later rung, so it wins the stage slot; a proposal still standing behind a
  // staged value is authorship evidence, not a second state.
  const stage = staged != null ? "staged" : proposal != null ? "proposed" : "clean";
  const stagedBy =
    staged != null &&
    proposal != null &&
    proposal.by === "pea" &&
    rungPayload(staged) === rungPayload(proposal)
      ? "pea"
      : "you";
  // Pea arguing against a staged value: both rungs stand and disagree. The fold draws; see
  // `counterValue` on StateCellProps.
  const contested =
    staged != null && proposal != null && rungPayload(proposal) !== rungPayload(staged)
      ? (proposal as { delete?: true }).delete === true
        ? "delete"
        : show(proposal.value)
      : undefined;
  return {
    ...facts,
    stage,
    ...(stage === "staged" ? { stagedBy } : {}),
    ...(contested != null ? { counterValue: contested } : {}),
    confidence: facts.confidence ?? proposal?.confidence ?? undefined,
    note: facts.note ?? proposal?.note ?? undefined,
  };
}

/** Round for display without float noise: 22.200000762 -> "22.2", 599.99994 -> "600". */
export function fmtNum(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}

/** Parse an edited number cell. Returns null when the text is not a number (commit is refused). */
export function parseCell(
  text: string,
  opts: { integer?: boolean; min?: number } = {},
): number | null {
  if (text.trim() === "") return null; // blank is not zero — an emptied cell commits nothing
  const parsed = opts.integer ? Number.parseInt(text, 10) : Number(text);
  if (Number.isNaN(parsed)) return null;
  return opts.min !== undefined && parsed < opts.min ? opts.min : parsed;
}

interface CellRead {
  /** The only two things allowed to own the cell BODY. */
  body: "proposed" | "locked" | null;
  /** Pea's fold without the body: a standing proposal against the shown/staged value. */
  contested: boolean;
  /** No real element behind it — the reserved dashed seam edge. */
  seam: boolean;
  /** The one squiggle slot; one winner. */
  unsettled: Unsettled | null;
  /** Nothing was ever attempted here — muted value, no squiggle, no marks. */
  never: boolean;
  /** Your unsaved edit (bold + caution square), pea's (pea square, no bold), or none. */
  unsaved: "you" | "pea" | null;
}

/**
 * The precedence, executed once. Every scale reads state through this, so the card, the table
 * and the key cannot disagree about what a cell is.
 */
export function readCell(p: StateCellProps): CellRead {
  const cap = p.cap ?? "editable";
  const locked = cap !== "editable";
  const stage = p.stage ?? "clean";
  return {
    body: locked ? "locked" : stage === "proposed" ? "proposed" : null,
    contested: !locked && stage !== "proposed" && p.counterValue != null,
    seam: cap === "nohome",
    unsettled:
      p.agree === "drift"
        ? "drift"
        : p.fresh === "stale"
          ? "stale"
          : p.fresh === "unverified"
            ? "unverified"
            : null,
    never: p.fresh === "never",
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
  "never",
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
  if (read.never) return "never";
  return "clean";
}

/**
 * The cell's prose facts as plain text, ranked — for the row-scale title and the table's
 * readout band. Same ranking as the card footline (capReason ▸ note ▸ citation), with the
 * ghost model value leading because drift is the one alarm.
 */
export function cellFactsText(p: StateCellProps): string | null {
  const parts: string[] = [];
  if (p.agree === "drift" && p.modelValue != null) parts.push(`model holds ${p.modelValue}`);
  if (p.counterValue != null) parts.push(`pea proposes ${p.counterValue}`);
  if (p.capReason != null) parts.push(p.capReason);
  if (p.note != null)
    parts.push(p.confidence != null ? `${p.confidence} confidence — ${p.note}` : p.note);
  else if (p.confidence === "low") parts.push("low confidence");
  if (p.grounding != null) parts.push(`${p.grounding.doc} p.${p.grounding.page}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
