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
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import { Check, Undo2, X, type LucideIcon } from "lucide-react";

import { tv } from "#/lib/tv";
import { useScopeKeys } from "#/route/keys";

import { ActionButton } from "./action-button";
import "./lang.css";

export const stateCellRecipe = tv({
  slots: {
    wrapper: "focus-visible:outline focus-visible:outline-line-2",
    base: "dl-cell focus-visible:outline focus-visible:outline-line-2",
    line: "dl-cell-line",
    input: "dl-cell-input",
    unsettled: "dl-sq",
    refusal: "dl-refuse",
    acts: "dl-acts",
    act: "dl-act",
    ghost: "dl-ghost",
    foot: "dl-foot",
    citation: "dl-cite",
    counter: "dl-counter",
  },
  variants: {
    size: { card: {}, row: {} },
  },
  defaultVariants: { size: "card" },
});

import {
  cellFactsText,
  fmtNum,
  parseCell,
  readCell,
  type CellTransition,
  type CellTransitionKind,
  type StateCellProps,
} from "./cell-state";

export {
  CELL_STATE_ORDER,
  cellFactsText,
  cellFromTrichotomy,
  cellStateLabel,
  fmtNum,
  parseCell,
} from "./cell-state";
export type {
  CellStateName,
  CellTransition,
  CellTransitionKind,
  StateCellProps,
  Unsettled,
} from "./cell-state";

/** Each kind's glyph, key and plain sentence. The caller's `reason` overrides the sentence. */
const TRANSITION: Record<CellTransitionKind, { icon: LucideIcon; key: string; says: string }> = {
  accept: { icon: Check, key: "a", says: "Stage Pea's proposal" },
  deny: { icon: X, key: "d", says: "Clear Pea's proposal" },
  unstage: { icon: Undo2, key: "u", says: "Clear the staged value" },
};

/**
 * A focused table cell's `a` / `d` / `u`, registered on the cell's own td so the chord beats the
 * table's type-to-edit (the hotkey stops propagation) and help lists them only while it is focused.
 * Inside the input the keys are text: single keys ignore inputs by default.
 */
function CellKeys({
  target,
  transitions,
  fire,
}: {
  target: HTMLElement;
  transitions: readonly CellTransition[];
  fire: (t: CellTransition) => void;
}) {
  useScopeKeys(
    transitions.map((t) => ({
      hotkey: TRANSITION[t.kind].key as "A",
      callback: () => fire(t),
      label: t.kind,
      says: t.reason ?? TRANSITION[t.kind].says,
    })),
    target,
  );
  return null;
}

/**
 * The element that owns a hosted cell's keyboard focus, provided by whatever hosts the cell:
 * Table hands each cell its td. Absent, the cell is its own host.
 */
/** The drawn empty value: a stated blank, as the band draws it. */
export const EMPTY_MARK = "–";

/** A refusal a cell says: the person's sentence, and optionally words written for Pea. */
export interface CellRefusal {
  message: string;
  /** Pea's words: drawn only behind a disclosure, never as the note. */
  detail?: string;
}

/** The refusal's words for Pea, folded away under the person's sentence. */
const RefusalDetail = ({ detail }: { detail: string }) => (
  <details className="dl-refuse-detail">
    <summary>detail</summary>
    <span>{detail}</span>
  </details>
);

export const CellHost = createContext<RefObject<HTMLElement | null> | null>(null);

export function StateCell(props: StateCellProps) {
  const { value, modelValue, capReason, grounding, confidence, note, counterValue } = props;
  const read = readCell(props);
  const reviewed = read.unsettled === "drift" && props.reviewed !== undefined && modelValue != null;
  // An emptied value IS a value (F-J4-1): a staged or proposed "" draws the empty mark, never the
  // caller's placeholder, which would read as the old value still standing.
  const emptied = value === "" && (props.stage === "staged" || props.stage === "proposed");
  const shown = emptied ? EMPTY_MARK : value;
  // Refusal machinery lives here so hooks run unconditionally; it only ever fires on an
  // editable row-scale cell. A refused edit restores the input's value IMPERATIVELY (the same
  // move Escape makes) rather than re-keying it, so the DOM node — and anything holding a
  // reference to it — survives the refusal.
  const [refusal, setRefusal] = useState<CellRefusal | null>(null);
  const initial = useRef(typeof value === "string" ? value : "");
  initial.current = typeof value === "string" ? value : "";

  // A transition in flight inerts every verb on the cell; its refusal rides the same note.
  const refusalNote = refusal ?? (props.refused != null ? { message: props.refused } : null);
  const [pending, startRun] = useTransition();
  const transitions = props.transitions ?? [];
  const fire = (t: CellTransition) => {
    if (pending) return;
    startRun(async () => {
      const out = await t.run().catch((cause: unknown) => ({
        code: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
      }));
      setRefusal(out ?? null);
    });
  };
  // The cell's keyboard host: whatever hosts the cell provides one (Table its td); a cell
  // hosted by nothing is its own host, focusable at any scale. Keys register only while it (or
  // its input) holds focus; Escape from the input hands focus back to it.
  const provided = useContext(CellHost);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [focusHost, setFocusHost] = useState<HTMLElement | null>(null);
  const hasTransitions = transitions.length > 0;
  const ownHost = provided == null && hasTransitions;
  const keyHost = () => provided?.current ?? (ownHost ? rootRef.current : null);
  useEffect(() => {
    const host = keyHost();
    if (!hasTransitions || !host) return;
    const on = () => setFocusHost(host);
    const off = (e: FocusEvent) => {
      if (!host.contains(e.relatedTarget as Node | null)) setFocusHost(null);
    };
    host.addEventListener("focusin", on);
    host.addEventListener("focusout", off);
    if (host.contains(document.activeElement)) setFocusHost(host);
    return () => {
      host.removeEventListener("focusin", on);
      host.removeEventListener("focusout", off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyHost reads refs, identified by these
  }, [hasTransitions, provided]);
  const keys =
    focusHost != null && hasTransitions ? (
      <CellKeys target={focusHost} transitions={transitions} fire={fire} />
    ) : null;

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
          setRefusal({
            message:
              text.trim() === ""
                ? "blank commits nothing — a cleared cell is not zero"
                : `"${text}" is not a number — nothing committed`,
          });
          return;
        }
        out = fmtNum(parsed, props.numeric.digits);
      }
      const settle = (refused: string | CellRefusal | null | void) => {
        if (refused != null) {
          el.value = initial.current; // restore the drawn value, visibly
          setRefusal(typeof refused === "string" ? { message: refused } : refused);
        } else if (refusal != null) {
          setRefusal(null);
        }
      };
      const refused = props.onCommit?.(out);
      if (refused instanceof Promise) void refused.then(settle);
      else settle(refused);
    };
    return (
      <span
        ref={rootRef}
        tabIndex={ownHost ? 0 : undefined}
        className={slots.base()}
        data-scale="row"
        data-focus={focusHost != null ? "" : undefined}
        aria-busy={pending || undefined}
        onClick={locate}
        data-body={read.body ?? undefined}
        data-seam={read.seam ? "" : undefined}
        data-contest={read.contested ? "" : undefined}
        data-never={read.never ? "" : undefined}
        data-unsaved={read.unsaved === "pea" ? "pea" : read.unsaved === "you" ? "" : undefined}
        data-locate={props.onLocate != null ? "" : undefined}
        title={cellFactsText(props) ?? undefined}
      >
        {editable ? (
          <input
            key={value as string}
            defaultValue={value as string}
            placeholder={emptied ? EMPTY_MARK : props.placeholder}
            data-empty={emptied ? "" : undefined}
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
                // No row that way: stay on this cell (its host), never drop focus to the page.
                if (!props.onNavigate?.(e.shiftKey ? "up" : "down")) {
                  const host = keyHost();
                  if (host) host.focus();
                  else e.currentTarget.blur();
                }
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                commit(e.currentTarget);
                props.onNavigate?.(e.key === "ArrowUp" ? "up" : "down");
              } else if (e.key === "Tab") {
                commit(e.currentTarget);
                if (props.onNavigate?.(e.shiftKey ? "left" : "right")) e.preventDefault();
              } else if (e.key === "Escape") {
                e.currentTarget.value = initial.current;
                // spreadsheet convention: Escape hands focus back to the cell, where a/d/u live
                const host = keyHost();
                if (host) host.focus();
                else e.currentTarget.blur();
              }
            }}
            onBlur={(e) => commit(e.currentTarget)}
          />
        ) : read.unsettled != null ? (
          <span className={slots.unsettled()} data-state={read.unsettled}>
            {shown}
          </span>
        ) : (
          shown
        )}
        {/* SPECIMEN: /design-system/band's words, on the row's one line: a contest a title alone
            hides from keyboard, touch and no-hover readers (E2E-J2 ruling). */}
        {read.contested ? (
          <span className={slots.counter()}>pea proposes {props.counterValue}</span>
        ) : null}
        {hasTransitions ? (
          <span className={slots.acts()}>
            {transitions.map((t) => {
              const Icon = TRANSITION[t.kind].icon;
              return (
                <button
                  key={t.kind}
                  type="button"
                  className={slots.act()}
                  aria-label={t.kind}
                  title={`${t.reason ?? TRANSITION[t.kind].says} (${TRANSITION[t.kind].key})`}
                  disabled={pending}
                  tabIndex={-1}
                  // the verb must never take the caret from the input it overlays
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => fire(t)}
                >
                  <Icon />
                </button>
              );
            })}
          </span>
        ) : null}
        {keys}
        {refusalNote != null ? (
          <button
            type="button"
            className={slots.refusal()}
            title={`${refusalNote.message} — click to dismiss`}
            // "do not steal the caret": the note must never take focus from the input under it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setRefusal(null)}
          >
            {refusalNote.message}
          </button>
        ) : null}
        {refusalNote?.detail ? <RefusalDetail detail={refusalNote.detail} /> : null}
      </span>
    );
  }

  // ONE footline, ranked and joined onto a single clamped line rather than stacked.
  const facts: React.ReactNode[] = [];
  if (capReason != null) facts.push(capReason);
  // SPECIMEN: /design-system/band. A counter fold without its value makes accept/deny illegible
  // in hoverless compact heads.
  if (counterValue != null) facts.push(`pea proposes ${counterValue}`);
  if (note != null) facts.push(confidence != null ? `${confidence} confidence — ${note}` : note);
  // A low confidence with nothing else to say still has to say it; silence would read as high.
  else if (confidence === "low") facts.push("low confidence");
  if (grounding != null)
    facts.push(
      <span className={slots.citation()} key="cite">
        {grounding.doc} p.{grounding.page}
      </span>,
    );

  // RULED 2026-08-31: a card-scale cell in a constrained context may not wrap to two lines, and
  // the 10px floor forbids shrinking the footline — so it collapses to the same hover the row
  // scale uses. `title` on the wrapper, `cellFactsText`, one ranking for both.
  const hoverFoot = props.foot === "hover";
  return (
    <span
      ref={rootRef}
      tabIndex={ownHost ? 0 : undefined}
      className={slots.wrapper()}
      aria-busy={pending || undefined}
      onClick={locate}
      title={hoverFoot ? (cellFactsText(props) ?? undefined) : undefined}
    >
      <span className={slots.line()}>
        {reviewed ? (
          <span className="shrink-0 whitespace-nowrap text-ink-2">
            you reviewed <span className="face-mono text-ink">{props.reviewed ?? "—"}</span> · Revit
            now{" "}
            <span className={slots.ghost()} title="the value the model currently holds">
              {modelValue}
            </span>{" "}
            · yours{" "}
          </span>
        ) : null}
        <span
          className={slots.base()}
          data-body={read.body ?? undefined}
          data-seam={read.seam ? "" : undefined}
          data-contest={read.contested ? "" : undefined}
          data-never={read.never ? "" : undefined}
          data-unsaved={read.unsaved === "pea" ? "pea" : read.unsaved === "you" ? "" : undefined}
          data-locate={props.onLocate != null ? "" : undefined}
        >
          {read.unsettled != null ? (
            <span className={slots.unsettled()} data-state={read.unsettled}>
              {shown}
            </span>
          ) : (
            shown
          )}
        </span>
        {!reviewed && read.unsettled === "drift" && modelValue != null ? (
          <span className={slots.ghost()} title="the value the model currently holds">
            {modelValue}
          </span>
        ) : null}
        {transitions.map((t) => (
          <ActionButton
            key={t.kind}
            tone={t.kind === "accept" ? "agent" : "act"}
            icon={TRANSITION[t.kind].icon}
            label={t.kind}
            reason={t.reason ?? TRANSITION[t.kind].says}
            busy={pending}
            onClick={() => fire(t)}
          />
        ))}
        {refusalNote != null ? (
          <button
            type="button"
            className={slots.refusal()}
            title={`${refusalNote.message} — click to dismiss`}
            onClick={() => setRefusal(null)}
          >
            {refusalNote.message}
          </button>
        ) : null}
        {refusalNote?.detail ? <RefusalDetail detail={refusalNote.detail} /> : null}
      </span>
      {keys}
      {facts.length > 0 && !hoverFoot ? (
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
