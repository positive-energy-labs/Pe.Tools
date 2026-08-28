/**
 * STATE CELL — the one grammar, at any scale.
 *
 * CONSUMERS: master-table cells; the trichotomy reviewer (soon); pea's chat proposal card
 * (soon — the card's staged values are this same treatment one scale up); `CellStateKey`, which
 * renders its specimens through this component precisely so the key cannot lie about the table.
 *
 * RULINGS EMBODIED:
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
import { useRef, useState } from "react";

import { cn } from "#/lib/utils";

import "./lang.css";

/** The one squiggle slot. Ranked; exactly one may draw. `never` is NOT here on purpose —
 * nothing exists to distrust, so it draws no squiggle (ruled 2026-08-16, consolidation batch). */
export type Unsettled = "drift" | "stale" | "unverified";

const SQUIGGLE_CLASS: Record<Unsettled, string> = {
  drift: "squiggle squiggle-drift",
  stale: "squiggle squiggle-stale",
  unverified: "squiggle squiggle-unverified",
};

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
   *
   * ponytail: the state model has no author on `staged`; `trichotomy.ts` stores `by` and every
   * consumer discards it.
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
   */
  onLocate?: () => void;
  /** Cell-to-cell navigation hook (Enter/Tab/arrows). Return true when the move was taken. */
  onNavigate?: (dir: "up" | "down" | "left" | "right") => boolean;
  className?: string;
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
  if (p.capReason != null) parts.push(p.capReason);
  if (p.note != null)
    parts.push(p.confidence != null ? `${p.confidence} confidence — ${p.note}` : p.note);
  else if (p.confidence === "low") parts.push("low confidence");
  if (p.grounding != null) parts.push(`${p.grounding.doc} p.${p.grounding.page}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function StateCell(props: StateCellProps) {
  const { value, modelValue, capReason, grounding, confidence, note, className } = props;
  const read = readCell(props);
  // Refusal machinery lives here so hooks run unconditionally; it only ever fires on an
  // editable row-scale cell. A refused edit restores the input's value IMPERATIVELY (the same
  // move Escape makes) rather than re-keying it, so the DOM node — and anything holding a
  // reference to it — survives the refusal.
  const [refusal, setRefusal] = useState<string | null>(null);
  const initial = useRef(typeof value === "string" ? value : "");
  initial.current = typeof value === "string" ? value : "";

  const editable = props.onCommit != null && read.body !== "locked" && typeof value === "string";
  const stateClass = cn(read.body === "locked" && "locked", read.unsaved === "you" && "unsaved");
  // Locate is a click on the cell BODY when not editing; an editable cell's input swallows its
  // own clicks (the caret owns them), so the handler can sit on the wrapper unconditionally.
  const locate =
    props.onLocate != null
      ? (event: React.MouseEvent) => {
          if ((event.target as HTMLElement).closest("input,button") != null) return;
          props.onLocate?.();
        }
      : undefined;

  if (props.scale === "row") {
    const commit = (el: HTMLInputElement) => {
      const text = el.value;
      if (text === initial.current) return;
      let out = text;
      if (props.numeric != null) {
        const parsed = parseCell(text, props.numeric);
        if (parsed === null) {
          el.value = initial.current; // restore the prior value, visibly
          setRefusal(
            text.trim() === ""
              ? "blank commits nothing — a cleared cell is not zero"
              : `"${text}" is not a number — nothing committed`,
          );
          return;
        }
        out = fmtNum(parsed, props.numeric.digits);
      }
      const refused = props.onCommit?.(out);
      if (typeof refused === "string") {
        el.value = initial.current; // restore the prior value, visibly
        setRefusal(refused);
      } else if (refusal != null) {
        setRefusal(null);
      }
    };
    return (
      <span
        className={cn("dl-cell", stateClass, locate != null && "cursor-pointer", className)}
        data-scale="row"
        onClick={locate}
        data-body={read.body ?? undefined}
        data-seam={read.seam ? "" : undefined}
        data-never={read.never ? "" : undefined}
        data-unsaved={read.unsaved === "pea" ? "pea" : read.unsaved === "you" ? "" : undefined}
        title={cellFactsText(props) ?? undefined}
      >
        {editable ? (
          <input
            key={value as string}
            defaultValue={value as string}
            placeholder={props.placeholder}
            inputMode={props.numeric != null ? "decimal" : undefined}
            tabIndex={-1}
            className={cn(
              "dl-cell-input",
              read.unsettled != null && SQUIGGLE_CLASS[read.unsettled],
            )}
            data-state={read.unsettled ?? undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget);
                if (!props.onNavigate?.(e.shiftKey ? "up" : "down")) e.currentTarget.blur();
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                commit(e.currentTarget);
                props.onNavigate?.(e.key === "ArrowUp" ? "up" : "down");
              } else if (e.key === "Tab") {
                commit(e.currentTarget);
                if (props.onNavigate?.(e.shiftKey ? "left" : "right")) e.preventDefault();
              } else if (e.key === "Escape") {
                e.currentTarget.value = initial.current;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => commit(e.currentTarget)}
          />
        ) : read.unsettled != null ? (
          <span className={SQUIGGLE_CLASS[read.unsettled]} data-state={read.unsettled}>
            {value}
          </span>
        ) : (
          value
        )}
        {refusal != null ? (
          <button
            type="button"
            className="dl-refuse"
            title={`${refusal} — click to dismiss`}
            // "do not steal the caret": the note must never take focus from the input under it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setRefusal(null)}
          >
            {refusal}
          </button>
        ) : null}
      </span>
    );
  }

  // ONE footline, ranked and joined onto a single clamped line rather than stacked.
  const facts: React.ReactNode[] = [];
  if (capReason != null) facts.push(capReason);
  if (note != null) facts.push(confidence != null ? `${confidence} confidence — ${note}` : note);
  // A low confidence with nothing else to say still has to say it; silence would read as high.
  else if (confidence === "low") facts.push("low confidence");
  if (grounding != null)
    facts.push(
      <span className="citation" key="cite">
        {grounding.doc} p.{grounding.page}
      </span>,
    );

  return (
    <span className={cn(locate != null && "cursor-pointer", className)} onClick={locate}>
      <span className="dl-cell-line">
        <span
          className={cn("dl-cell", stateClass)}
          data-body={read.body ?? undefined}
          data-seam={read.seam ? "" : undefined}
          data-never={read.never ? "" : undefined}
          data-unsaved={read.unsaved === "pea" ? "pea" : read.unsaved === "you" ? "" : undefined}
        >
          {read.unsettled != null ? (
            <span className={SQUIGGLE_CLASS[read.unsettled]} data-state={read.unsettled}>
              {value}
            </span>
          ) : (
            value
          )}
        </span>
        {read.unsettled === "drift" && modelValue != null ? (
          <span className="ghost-drift" title="the value the model currently holds">
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
