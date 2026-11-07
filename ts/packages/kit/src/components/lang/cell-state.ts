import {
  type CellLike,
  type MeasuredDisplayUnit,
  type MeasuredValue,
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

export interface StateCellBase {
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
  /** Whether a staged value (any author's, ADR 0030 rule 8) is sitting on this cell. */
  stage?: "clean" | "edit";
  /** Host-stamped author of the staged value. Equal values do not establish who wrote an edit. */
  author?: "pea" | "human" | "unknown";
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
  /** Semantic selection request; the cell lands its own input when the key changes. */
  land?: string;
  /**
   * Locate what this cell describes: a click on the cell body when not editing. An editable
   * cell's input swallows its clicks, so the unsaved square (outside the input) is the locate target
   * there. A cell with `onLocate` and no mark locates on its body.
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

/** One value of a choice cell's closed set: what it is called, and what picking it means. */
export interface CellOption {
  key: string;
  label: string;
  /** What the option means for whatever reads the cell; never the mechanism that writes it. */
  description?: string;
  /**
   * Present, the option stays listed but greyed and cannot be picked by mouse or keyboard; the
   * reason is drawn in place of the description. For a value the world refuses, never a hidden one.
   */
  disabled?: string;
}

/** What picking an option commits: a refusal back, or nothing (the same contract as `onCommit`). */
export type CellPick = (key: string) => string | void | Promise<string | CellRefusal | null | void>;

/**
 * A cell commits text (`onCommit`), a measured value (`measured`), or one of a closed set of
 * options (`choice`), never two.
 */
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
        choice?: never;
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
        choice?: never;
      }
    | {
        /**
         * The choice cell: a closed option set, picked from a list under the cell. The body, fill,
         * squiggle and marks are the text cell's, so an option Pea staged draws as any staged value
         * with Pea's author, and clear rides `transitions` as on any cell. `value` is the shown option's label; `current`
         * is the key standing now (the edit or the source underneath), marked selected in the list.
         * A pick of `current` commits nothing. Requires `scale="row"`; `cap` other than editable
         * draws the value locked, with no list.
         */
        choice: { options: readonly CellOption[]; current: string | null; pick: CellPick };
        onCommit?: never;
        measured?: never;
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
  if (
    !BARE_NUMBER.test(typed) ||
    /feetFractionalInches|fractionalInches/.test(displayUnit?.typeId ?? "")
  )
    return { kind: "parse", text: typed };
  const unit = displayUnit ? unitWord(displayUnit) : null;
  return unit
    ? { kind: "set", edit: { value: typed, unit } }
    : {
        kind: "refuse",
        reason:
          "Revit did not report this measured parameter's display unit, so this cell cannot be edit.",
      };
}

export type CellTransitionKind = "clear";

export interface CellTransition {
  kind: CellTransitionKind;
  /** Resolves to a refusal when the write was refused; nothing or null when it landed. */
  run: () => Promise<{ code: string; message: string; detail?: string } | null | void>;
  /** What pressing it does, in this cell's words. Defaults to the kind's plain sentence. */
  reason?: string;
}

/** Shared Work plus measured facts becomes one cell drawing. Attribution is host stamped. */
type DrawingCell<Value> = {
  [K in keyof CellLike]:
    | (Omit<NonNullable<CellLike[K]>, "value"> & { readonly value?: Value })
    | null;
};
/**
 * One staged value becomes the drawing (ADR 0030 rule 8): the person's and Pea's writes are the
 * same `edit`, last writer wins, the host stamps `by`. The caller's value is already the resolved
 * one; the model value it overrides rides `modelValue` (drift), never a second lane.
 */
export function cellFromDraft<Value>(
  cell: DrawingCell<Value>,
  facts: StateCellBase,
): StateCellBase {
  const { edit } = cell;
  return {
    ...facts,
    stage: edit != null ? "edit" : "clean",
    author: edit?.by ?? "unknown",
    confidence: facts.confidence ?? edit?.confidence ?? undefined,
    note: facts.note ?? edit?.note ?? undefined,
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
  /** The only thing allowed to own the cell BODY. */
  body: "locked" | null;
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
    body: locked ? "locked" : null,
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
    unsaved: !locked && stage === "edit" ? (p.author ?? "unknown") : null,
  };
}

/**
 * Cell state, in the order attention is owed: fix drift, commit the edit,
 * re-read the stale, check the unverified, leave clean alone, and locked last — nothing to do.
 * A state column with no explicit `sort` orders by this, not alphabetically.
 */
export const CELL_STATE_ORDER = [
  "damage",
  "drift",
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
export const stagedBy = (author: StateCellBase["author"]) =>
  author === "pea" ? "Pea" : author === "human" ? "you" : "unknown author";
export function cellFactsText(p: StateCellProps): string | null {
  const parts: string[] = [];
  if (p.damage) parts.push(p.damage);
  if (p.agree === "drift" && p.modelValue != null)
    parts.push(
      p.reviewed !== undefined
        ? `you reviewed ${p.reviewed ?? "—"} · Revit now ${p.modelValue} · yours`
        : `model holds ${p.modelValue}`,
    );
  if (p.stage === "edit") parts.push(`staged by ${stagedBy(p.author)}`);
  if (p.capReason != null) parts.push(p.capReason);
  if (p.note != null)
    parts.push(p.confidence != null ? `${p.confidence} confidence — ${p.note}` : p.note);
  else if (p.confidence === "low") parts.push("low confidence");
  if (p.grounding != null) parts.push(`${p.grounding.doc} p.${p.grounding.page}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
