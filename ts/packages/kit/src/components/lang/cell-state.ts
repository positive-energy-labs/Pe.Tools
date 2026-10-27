import {
  type MeasuredDisplayUnit,
  type MeasuredValue,
  sameValue,
  type CellLike,
} from "@pe/agent-contracts";
import type React from "react";

/** The one squiggle slot. Ranked; exactly one may draw. `never` is not here: nothing exists to distrust. */
type Unsettled = "drift" | "stale" | "unverified";

/** A refusal a cell says: the person's sentence, and optionally words written for Pea. */
export interface CellRefusal {
  message: string;
  /** Pea's words: drawn only behind a disclosure, never as the note. */
  detail?: string;
}

/** What typing into an editable cell commits: the text, and a refusal back or nothing. */
export type CellCommit = (
  text: string,
) => string | void | Promise<string | CellRefusal | null | void>;

interface StateCellBase {
  /** The value as shown. Long values are expected — the grammar is built around them. */
  value: React.ReactNode;
  /**
   * What the model currently holds, when it disagrees. Renders as the struck inline ghost token
   * beside the value — drift's second half, at zero row-height cost.
   */
  modelValue?: string;
  /**
   * A stale edit cell's A: the value the person reviewed against before Revit
   * moved under it (`basis.stale[].was`; null when unread). Present on drift, the cell reads in
   * words: "you reviewed A · Revit now C · yours B", C being `modelValue` and B the value.
   */
  reviewed?: string | null;
  /**
   * How much we know about this value: `fresh` checked recently · `stale` checked long ago ·
   * `unverified` a value exists but was never checked · `never` nothing was ever attempted.
   * The first three rank in the squiggle slot below `agree`; `never` draws no squiggle and mutes the value.
   */
  fresh?: "fresh" | "stale" | "unverified" | "never";
  /** Whether the model holds the same value. `drift` is the ONE alarm. */
  agree?: "agree" | "drift";
  /** A blocking value: damage stays on the cell at either scale. */
  damage?: string | null;
  /** Whose unsaved event, if any, is sitting on this cell. */
  stage?: "clean" | "proposed" | "edit";
  /** Host-stamped author. Equal values do not establish who wrote an edit. */
  author?: "pea" | "human" | "unknown";
  suggestionAuthor?: "pea" | "human" | "unknown";
  /**
   * The counter-suggestion: pea's standing proposed value when
   * it is not what the cell shows — suggestion and edit both present, values differing. Draws the
   * fold alone (no body wash — the shown value is not pea's) and rides the facts/footline. This
   * is pea's in-cell voice against a edit value; its other channel is chat.
   */
  counterValue?: string;
  /**
   * The original: a proposed cell draws Pea's value, so what the model
   * holds under it rides here — the row-scale title and the card footline say "currently X".
   * `cellFromDraft` fills it from the value the caller passed, which is the current one.
   */
  currentValue?: string;
  /**
   * Whether the cell can be written at all. Anything but `editable` owns the body.
   * `readonly` and `excluded` are one rendering: `locked`, with the distinction in `capReason`.
   * `nohome` draws the seam.
   */
  cap?: "editable" | "locked" | "nohome";
  /** Why it refuses edits. Present exactly when `cap` is not `editable`; ranks first on the footline. */
  capReason?: string;
  /** Where the number came from. Renders as the plain-underline citation, last on the footline. */
  grounding?: { doc: string; page: number };
  confidence?: "high" | "low";
  note?: string;
  /**
   * "row": inside a table a cell is one clipped line, the value plus zero-footprint marks. No
   * footline or inline ghost; those facts live in the table's readout band and the title.
   * "card" (default) keeps the footline.
   */
  scale?: "card" | "row";
  /**
   * Row scale only: the unit drawn INSIDE the box as an always-visible trailing suffix, so an empty
   * or unfocused cell still says what goes there. `short` is what a narrow `.dl-cells` container
   * shows instead (`in-wg` -> `wg`). SEAM for a later unit combo: when typed units arrive (Pa as
   * well as in-wg) this becomes a `units` list with the chosen one; the suffix turns into its
   * trigger. Not built: the unit is display only today.
   */
  unit?: { label: string; short?: string };
  /**
   * Where the card-scale footline goes. It may not wrap to two lines nor shrink below the 10px
   * floor, so in a constrained context it collapses to `hover` (the `title` row scale uses);
   * `inline` keeps it where the card has room. Row scale is always hover.
   */
  foot?: "inline" | "hover";
  /**
   * Numeric commit: present ⇒ the commit path parses per `parseCell` before `onCommit` sees anything. A
   * refused parse (blank, not a number) RETURNS a reason, so the built-in refusal note fires —
   * never a silent restore. Integers truncate, `min` clamps, and `onCommit` receives the
   * normalized text (`fmtNum`, `digits`).
   */
  numeric?: { integer?: boolean; min?: number; digits?: number };
  /** Placeholder for the editable value slot — e.g. an inherited value the cell would take. */
  placeholder?: string;
  /**
   * Locate what this cell describes: a click on the cell body when not editing. An editable
   * cell's input swallows its clicks, so the suggestion fold and the unsaved square (outside the
   * input) are the locate target there. A cell with `onLocate` and no mark locates on its body.
   */
  onLocate?: () => void;
  /** Cell-to-cell navigation hook (Enter/Tab/arrows). Return true when the move was taken. */
  onNavigate?: (dir: "up" | "down" | "left" | "right") => boolean;
  /**
   * The cell's own verbs, as transitions. The caller decides which kinds are available; the cell draws exactly these,
   * in this order, and holds NO availability logic. Typing is `stage` and stays `onCommit`.
   * Card scale draws them inline after the value. Row scale costs zero footprint: they overlay
   * the trailing edge while the cell is hovered or focused, and a focused table cell takes
   * `a` / `d` / `u` through the hotkey registry. A run in flight marks the cell busy and inerts
   * its verbs; a returned refusal shows its message beside the cell (the `onCommit` note).
   */
  transitions?: readonly CellTransition[];
  /**
   * A refusal this cell did not ask for: an aggregate's one write covered it and was refused.
   * Drawn in the same note as the cell's own refusal; the caller clears it on its next write.
   */
  refused?: string;
}

/** A cell commits text (`onCommit`) or a measured value (`measured`), never both. */
export type StateCellProps = StateCellBase &
  (
    | {
        /**
         * The editable cell. Present ⇒ the value slot renders as a caret-safe input; every mark
         * stays OUTSIDE the text box ("do not steal the caret"). Return a string to REFUSE the
         * commit: the cell restores the prior value and shows a dismissible caution note carrying
         * the reason, near the cell, without resizing the row. Requires
         * `scale="row"` and a string `value`; `cap` other than editable wins and renders locked.
         * An async commit (a Work write) may return a promise of that refusal: it restores the same
         * way when the refusal arrives, so typed text is never left looking accepted.
         *
         * A measured cell never has one — its edit value is an object, so it has its own
         * `measured.stage`; the type makes the two doors exclusive.
         */
        onCommit?: CellCommit;
        measured?: never;
      }
    | {
        /**
         * The measured cell, one kind beside `numeric`. A bare number stages at once
         * with the column's display unit and never calls Revit, so the cell reads "300 CFM" the moment
         * it is edit and what is reviewed is what is applied. Text carrying a unit shows as typed
         * until commit, then ONE read-only host parse answers with Revit's unrounded value,
         * which is what gets edit; a re-read of the Reading cancels it (`parse` resolves null). A
         * refusal is cell-local, carries Revit's reason, and stages nothing. A measured column with no
         * display unit refuses at the cell; the unit is always the Reading's own evidence, never a
         * web guess. A caller with no display unit locks the cell because the parse needs one.
         */
        measured: {
          displayUnit?: MeasuredDisplayUnit | null;
          /** Effect-owned; null means the call was cancelled and the cell keeps what it had. */
          parse: (text: string) => Promise<MeasuredValue | { refusal: string } | null>;
          /** Where `{ value, unit }` goes — this kind's `onCommit`, and the only door the object takes. */
          stage: (
            edit: MeasuredValue,
          ) => string | void | Promise<string | CellRefusal | null | void>;
        };
        onCommit?: never;
      }
  );

/** The word a display unit is drawn and edit under: its symbol when it has one, else its label. */
export const unitWord = (unit: MeasuredDisplayUnit): string | null =>
  unit.symbol || unit.label || null;

/** What one commit into a measured cell does — decided before anything is called. */
type MeasuredCommit =
  | { kind: "set"; edit: MeasuredValue }
  | { kind: "parse"; text: string }
  | { kind: "refuse"; reason: string };

const BARE_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * The measured cell's one decision, pure: a bare number stages with the column's unit (or asks for
 * one when the column has none), anything else goes to Revit. Blank is refused like `parseCell`'s —
 * an emptied cell is not zero.
 */
export function readMeasuredText(
  text: string,
  displayUnit: MeasuredDisplayUnit | null | undefined,
): MeasuredCommit {
  const typed = text.trim();
  if (typed === "")
    return { kind: "refuse", reason: "blank commits nothing — a cleared cell is not zero" };
  // Revit failed to read this spec's unit: nothing may be assumed, so the cell says why.
  if (displayUnit?.refusal) return { kind: "refuse", reason: displayUnit.refusal };
  if (!BARE_NUMBER.test(typed)) return { kind: "parse", text: typed };
  const unit = displayUnit ? unitWord(displayUnit) : null;
  return unit
    ? { kind: "set", edit: { value: typed, unit } }
    : {
        kind: "refuse",
        reason:
          "Revit did not report this measured parameter's display unit, so this cell cannot be edit.",
      };
}

export type CellTransitionKind = "take" | "unsuggest" | "clear";

export interface CellTransition {
  kind: CellTransitionKind;
  /** Resolves to a refusal when the write was refused; nothing or null when it landed. */
  run: () => Promise<{ code: string; message: string; detail?: string } | null | void>;
  /** What pressing it does, in this cell's words. Defaults to the kind's plain sentence. */
  reason?: string;
}

/** The default counter word: a string as written, anything else as JSON — never `[object Object]`. */
const showJson = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** Shared Work plus measured facts becomes one cell drawing. Attribution is host stamped. */
export function cellFromDraft(
  cell: Pick<CellLike, "suggestion" | "edit">,
  facts: StateCellBase,
  /** The caller's word for a counter-proposed value; domain values are the caller's to format. */
  show: (value: unknown) => string = showJson,
): StateCellBase {
  const { suggestion, edit } = cell;
  const stage = edit != null ? "edit" : suggestion != null ? "proposed" : "clean";
  const author = edit?.by ?? suggestion?.by ?? "unknown";
  const contested =
    edit != null && suggestion != null && !sameValue(suggestion, edit)
      ? suggestion.delete === true
        ? "delete"
        : show(suggestion.value)
      : undefined;
  // A standing suggestion is what the cell DRAWS; the caller's value, which is
  // the current one, moves to `currentValue` and the tooltip. A deletion draws the empty mark.
  const proposedText =
    stage === "proposed" ? (suggestion?.delete === true ? "" : show(suggestion?.value)) : undefined;
  const callerText =
    typeof facts.value === "string" || typeof facts.value === "number"
      ? String(facts.value)
      : undefined;
  const flipped = proposedText !== undefined && callerText !== proposedText;
  return {
    ...facts,
    ...(flipped ? { value: proposedText } : {}),
    ...(flipped && facts.currentValue === undefined && callerText !== undefined
      ? { currentValue: callerText === "" ? "(blank)" : callerText }
      : {}),
    stage,
    author,
    suggestionAuthor: suggestion?.by ?? "unknown",
    ...(contested != null ? { counterValue: contested } : {}),
    confidence: facts.confidence ?? suggestion?.confidence ?? undefined,
    note: facts.note ?? suggestion?.note ?? undefined,
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
  /** Pea's fold without the body: a standing suggestion against the shown/edit value. */
  contested: boolean;
  /** No real element behind it — the reserved dashed seam edge. */
  seam: boolean;
  /** The one squiggle slot; one winner. */
  unsettled: Unsettled | null;
  /** Nothing was ever attempted here — muted value, no squiggle, no marks. */
  never: boolean;
  /** Your unsaved edit (bold + caution square), pea's (pea square, no bold), or none. */
  unsaved: "human" | "pea" | "unknown" | null;
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
    // An open suggestion is unsaved too, but its square is drawn off `body: "proposed"` (cell.css). This slot is only for a STAGED value, whose author is the open question.
    unsaved: !locked && stage === "edit" ? (p.author ?? "unknown") : null,
  };
}

/**
 * Cell state, in the order attention is owed: fix drift, review the suggestion, commit the edit,
 * re-read the stale, check the unverified, leave clean alone, and locked last — nothing to do.
 * A state column with no explicit `sort` orders by this, not alphabetically.
 */
export const CELL_STATE_ORDER = [
  "damage",
  "drift",
  "proposed",
  "edit",
  "stale",
  "unverified",
  "never",
  "clean",
  "locked",
] as const;
type CellStateName = (typeof CELL_STATE_ORDER)[number];

/**
 * The precedence collapsed to one word — the vocabulary a table can facet, count and group by.
 * Executes the same `readCell` as the renderer, so the word and the marks cannot disagree.
 */
export function cellStateLabel(p: StateCellProps): CellStateName {
  const read = readCell(p);
  if (p.damage) return "damage";
  if (read.body === "locked") return "locked";
  if (read.unsettled === "drift") return "drift";
  if (read.body === "proposed") return "proposed";
  if (read.unsaved != null) return "edit";
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
  if (p.damage) parts.push(p.damage);
  if (p.agree === "drift" && p.modelValue != null)
    parts.push(
      p.reviewed !== undefined
        ? `you reviewed ${p.reviewed ?? "—"} · Revit now ${p.modelValue} · yours`
        : `model holds ${p.modelValue}`,
    );
  if (p.counterValue != null)
    parts.push(`suggestion by ${p.suggestionAuthor ?? "unknown"}: ${p.counterValue}`);
  // The suggestion is what the cell draws; the original and the author ride the tooltip.
  if (p.stage === "proposed")
    parts.push(`suggested by ${p.suggestionAuthor ?? p.author ?? "unknown"}`);
  if (p.currentValue != null && p.stage === "proposed") parts.push(`currently ${p.currentValue}`);
  if (p.capReason != null) parts.push(p.capReason);
  if (p.note != null)
    parts.push(p.confidence != null ? `${p.confidence} confidence — ${p.note}` : p.note);
  else if (p.confidence === "low") parts.push("low confidence");
  if (p.grounding != null) parts.push(`${p.grounding.doc} p.${p.grounding.page}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
