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

import { tv } from "#/lib/tv";

import "./lang.css";

export const stateCellRecipe = tv({
  slots: {
    wrapper: "",
    base: "dl-cell",
    line: "dl-cell-line",
    input: "dl-cell-input",
    unsettled: "dl-sq",
    refusal: "dl-refuse",
    ghost: "dl-ghost",
    foot: "dl-foot",
    citation: "dl-cite",
  },
  variants: {
    size: { card: {}, row: {} },
  },
  defaultVariants: { size: "card" },
});

import { cellFactsText, fmtNum, parseCell, readCell, type StateCellProps } from "./cell-state";

export { CELL_STATE_ORDER, cellFactsText, cellStateLabel, fmtNum, parseCell } from "./cell-state";
export type { CellStateName, StateCellProps, Unsettled } from "./cell-state";

export function StateCell(props: StateCellProps) {
  const { value, modelValue, capReason, grounding, confidence, note } = props;
  const read = readCell(props);
  // Refusal machinery lives here so hooks run unconditionally; it only ever fires on an
  // editable row-scale cell. A refused edit restores the input's value IMPERATIVELY (the same
  // move Escape makes) rather than re-keying it, so the DOM node — and anything holding a
  // reference to it — survives the refusal.
  const [refusal, setRefusal] = useState<string | null>(null);
  const initial = useRef(typeof value === "string" ? value : "");
  initial.current = typeof value === "string" ? value : "";

  const editable = props.onCommit != null && read.body !== "locked" && typeof value === "string";
  // Locate is a click on the cell BODY when not editing; an editable cell's input swallows its
  // own clicks (the caret owns them), so the handler can sit on the wrapper unconditionally.
  const locate =
    props.onLocate != null
      ? (event: React.MouseEvent) => {
          if ((event.target as HTMLElement).closest("input,button") != null) return;
          props.onLocate?.();
        }
      : undefined;
  const slots = stateCellRecipe({
    size: props.scale ?? "card",
  });

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
        className={slots.base()}
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
            className={
              read.unsettled != null ? slots.unsettled({ className: slots.input() }) : slots.input()
            }
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
          <span className={slots.unsettled()} data-state={read.unsettled}>
            {value}
          </span>
        ) : (
          value
        )}
        {refusal != null ? (
          <button
            type="button"
            className={slots.refusal()}
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
      <span className={slots.citation()} key="cite">
        {grounding.doc} p.{grounding.page}
      </span>,
    );

  return (
    <span className={slots.wrapper()} onClick={locate}>
      <span className={slots.line()}>
        <span
          className={slots.base()}
          data-body={read.body ?? undefined}
          data-seam={read.seam ? "" : undefined}
          data-never={read.never ? "" : undefined}
          data-unsaved={read.unsaved === "pea" ? "pea" : read.unsaved === "you" ? "" : undefined}
        >
          {read.unsettled != null ? (
            <span className={slots.unsettled()} data-state={read.unsettled}>
              {value}
            </span>
          ) : (
            value
          )}
        </span>
        {read.unsettled === "drift" && modelValue != null ? (
          <span className={slots.ghost()} title="the value the model currently holds">
            {modelValue}
          </span>
        ) : null}
      </span>
      {facts.length > 0 ? (
        <span className={slots.foot()}>
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
