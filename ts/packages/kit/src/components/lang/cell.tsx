import { reachProps } from "./reach";
import { useWork } from "./pane";
/**
 * The cell: one grammar for a value at any scale (table td, card line, key specimen).
 * Body fill is only a pea suggestion or locked; bold is only unsaved; one squiggle wins; icons
 * never go inside a data cell. Precedence is the cascade order in cell.css.
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

import { tv } from "../../lib/tv";
import { useScopeKeys } from "../../keys";

import { Verdict } from "./verdict";
import "./lang.css";
import "./cell.css";

export const stateCellRecipe = tv({
  slots: {
    base: "dl-cell",
    line: "dl-cell-line",
    input: "dl-cell-input",
    unsettled: "dl-sq",
    refusal: "dl-refuse",
    acts: "dl-acts",
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
  readMeasuredText,
  type CellCommit,
  type CellRefusal,
  type CellTransition,
  type CellTransitionKind,
  type StateCellProps,
} from "./cell-state";
import { TooltipHint } from "./tooltip";

export {
  CELL_STATE_ORDER,
  cellFactsText,
  cellFromDraft,
  cellStateLabel,
  fmtNum,
  readMeasuredText,
  unitWord,
} from "./cell-state";
export type {
  CellCommit,
  CellRefusal,
  CellTransition,
  CellTransitionKind,
  StateCellProps,
} from "./cell-state";
import { focusQuiet } from "../../lib/utils";

/** Each kind's glyph, key and plain sentence. The caller's `reason` overrides the sentence. */
const TRANSITION: Record<CellTransitionKind, { key: string; says: string }> = {
  take: { key: "a", says: "Stage the agent's suggestion" },
  unsuggest: { key: "d", says: "Clear the agent's suggestion" },
  clear: { key: "u", says: "Clear the edit value" },
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
const EMPTY_MARK = "–";

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
  // An emptied value IS a value (F-J4-1): a edit or proposed "" draws the empty mark, never the
  // caller's placeholder, which would read as the old value still standing.
  const emptied = value === "" && (props.stage === "edit" || props.stage === "proposed");
  const shown = emptied ? EMPTY_MARK : value;
  // Refusal machinery lives here so hooks run unconditionally; it only ever fires on an
  // editable row-scale cell. A refused edit restores the input's value IMPERATIVELY (the same
  // move Escape makes) rather than re-keying it, so the DOM node — and anything holding a
  // reference to it — survives the refusal.
  const [refusal, setRefusal] = useState<CellRefusal | null>(null);
  const initial = useRef(typeof value === "string" ? value : "");
  initial.current = typeof value === "string" ? value : "";
  const editVersion = useRef(0);
  const submitted = useRef<string | null>(null);
  const priorValue = useRef(value);
  useEffect(
    () => () => {
      editVersion.current++;
    },
    [],
  );
  useEffect(() => {
    if (priorValue.current !== value) {
      editVersion.current++;
      submitted.current = null;
      priorValue.current = value;
    }
  }, [value]);

  // A transition in flight inerts every verb on the cell; its refusal rides the same note.
  const refusalNote = refusal ?? (props.refused != null ? { message: props.refused } : null);
  const [pending, startRun] = useTransition();
  useWork(pending, "applying cell change…");
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

  const editable =
    (props.onCommit != null || props.measured != null) &&
    read.body !== "locked" &&
    typeof value === "string";
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
      if (text === initial.current || text === submitted.current) return;
      submitted.current = text;
      const version = ++editVersion.current;
      let out = text;
      if (props.numeric != null) {
        const parsed = parseCell(text, props.numeric);
        if (parsed === null) {
          submitted.current = null;
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
        if (version !== editVersion.current) return;
        submitted.current = null;
        if (refused != null) {
          el.value = initial.current; // restore the drawn value, visibly
          setRefusal(typeof refused === "string" ? { message: refused } : refused);
        } else if (refusal != null) {
          setRefusal(null);
        }
      };
      const send = (refused: ReturnType<CellCommit>) => {
        if (refused instanceof Promise) void refused.then(settle);
        else settle(refused);
      };
      // The measured kind: a bare number stages with the column's unit and calls nothing; anything
      // else is Revit's to read, and the typed text stays on screen until it answers.
      const measured = props.measured;
      if (measured != null) {
        const decided = readMeasuredText(out, measured.displayUnit);
        if (decided.kind === "refuse") {
          submitted.current = null;
          el.value = initial.current;
          setRefusal({ message: decided.reason });
        } else if (decided.kind === "set") send(measured.stage(decided.edit));
        else
          void measured.parse(decided.text).then((answer) => {
            if (version !== editVersion.current) return;
            if (answer == null) {
              submitted.current = null;
              el.value = initial.current; // a re-read cancelled it
              return;
            }
            if ("refusal" in answer) {
              submitted.current = null;
              el.value = initial.current;
              setRefusal({ message: answer.refusal });
            } else send(measured.stage(answer));
          });
        return;
      }
      send(props.onCommit?.(out));
    };
    return (
      <TooltipHint content={cellFactsText(props) ?? undefined}>
        <span
          {...reachProps()}
          ref={rootRef}
          tabIndex={ownHost ? 0 : undefined}
          className={slots.base()}
          data-scale="row"
          data-unit={props.unit != null ? "" : undefined}
          // The whole box is the input's: a press on the unit or padding focuses it, caret last.
          onMouseDown={
            editable
              ? (event) => {
                  const input = event.currentTarget.querySelector("input");
                  if (input == null || event.target === input) return;
                  if ((event.target as HTMLElement).closest("button") != null) return;
                  event.preventDefault();
                  focusQuiet(input);
                  input.setSelectionRange(input.value.length, input.value.length);
                }
              : undefined
          }
          data-focus={focusHost != null ? "" : undefined}
          aria-busy={pending || undefined}
          onClick={locate}
          data-body={read.body ?? undefined}
          data-author={props.author}
          data-suggestion-author={props.suggestionAuthor}
          data-damage={props.damage || undefined}
          data-seam={read.seam ? "" : undefined}
          data-contest={read.contested ? "" : undefined}
          data-never={read.never ? "" : undefined}
          data-unsaved={
            read.unsaved === "pea"
              ? "pea"
              : read.unsaved === "human"
                ? "human"
                : read.unsaved === "unknown"
                  ? "unknown"
                  : undefined
          }
          data-locate={props.onLocate != null ? "" : undefined}
        >
          {editable ? (
            <input
              key={value as string}
              defaultValue={value as string}
              placeholder={
                emptied || (props.unit != null && !props.placeholder)
                  ? EMPTY_MARK
                  : props.placeholder
              }
              data-empty={emptied ? "" : undefined}
              inputMode={props.numeric != null ? "decimal" : undefined}
              tabIndex={-1}
              className={
                read.unsettled != null
                  ? slots.unsettled({ className: slots.input() })
                  : slots.input()
              }
              data-state={read.unsettled ?? undefined}
              onChange={() => {
                editVersion.current++;
                submitted.current = null;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(e.currentTarget);
                  // No row that way: stay on this cell (its host), never drop focus to the page.
                  if (!props.onNavigate?.(e.shiftKey ? "up" : "down")) {
                    const host = keyHost();
                    if (host) focusQuiet(host);
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
                  editVersion.current++;
                  submitted.current = null;
                  e.currentTarget.value = initial.current;
                  // spreadsheet convention: Escape hands focus back to the cell, where a/d/u live
                  const host = keyHost();
                  if (host) focusQuiet(host);
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
          {props.unit != null ? (
            <span className="dl-cell-unit">
              <span className="dl-cell-unit-full">{props.unit.label}</span>
              <span className="dl-cell-unit-short" aria-hidden>
                {props.unit.short ?? props.unit.label}
              </span>
            </span>
          ) : null}
          {/* A contest on the row's one line: a title alone hides it from keyboard, touch and no-hover readers. */}
          {read.contested ? (
            <span className={slots.counter()}>agent proposes {props.counterValue}</span>
          ) : null}
          {hasTransitions ? (
            <span className={slots.acts()}>
              {transitions.map((t) => (
                <TooltipHint
                  content={`${t.reason ?? TRANSITION[t.kind].says} (${TRANSITION[t.kind].key})`}
                  key={t.kind}
                >
                  <Verdict
                    kind={t.kind}
                    disabled={pending}
                    tabIndex={-1}
                    // the verb must never take the caret from the input it overlays
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => fire(t)}
                  />
                </TooltipHint>
              ))}
            </span>
          ) : null}
          {keys}
          {refusalNote != null ? (
            <TooltipHint content={`${refusalNote.message} — click to dismiss`}>
              <button
                type="button"
                className={slots.refusal()}
                // "do not steal the caret": the note must never take focus from the input under it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRefusal(null)}
              >
                {refusalNote.message}
              </button>
            </TooltipHint>
          ) : null}
          {refusalNote?.detail ? <RefusalDetail detail={refusalNote.detail} /> : null}
        </span>
      </TooltipHint>
    );
  }

  // ONE footline, ranked and joined onto a single clamped line rather than stacked.
  const facts: React.ReactNode[] = [];
  if (props.damage) facts.push(props.damage);
  if (capReason != null) facts.push(capReason);
  // SPECIMEN: /design-system/band. A counter fold without its value makes accept/deny illegible
  // in hoverless compact heads.
  if (counterValue != null) facts.push(`agent proposes ${counterValue}`);
  if (props.stage === "proposed" && props.currentValue != null)
    facts.push(`currently ${props.currentValue}`);
  if (note != null) facts.push(confidence != null ? `${confidence} confidence — ${note}` : note);
  // A low confidence with nothing else to say still has to say it; silence would read as high.
  else if (confidence === "low") facts.push("low confidence");
  if (grounding != null)
    facts.push(
      <span className={slots.citation()} key="cite">
        {grounding.doc} p.{grounding.page}
      </span>,
    );

  // A constrained card-scale cell may not wrap or shrink its footline: it collapses to the row
  // scale's hover (`title` on the wrapper, `cellFactsText`, one ranking for both).
  const hoverFoot = props.foot === "hover";
  return (
    <TooltipHint content={hoverFoot ? (cellFactsText(props) ?? undefined) : undefined}>
      <span
        ref={rootRef}
        tabIndex={ownHost ? 0 : undefined}
        aria-busy={pending || undefined}
        onClick={locate}
      >
        <span className={slots.line()}>
          {reviewed ? (
            <span className="shrink-0 whitespace-nowrap text-ink-2">
              you reviewed <span className="face-mono text-ink">{props.reviewed ?? "—"}</span> ·
              Revit now{" "}
              <TooltipHint content="the value the model currently holds">
                <span className={slots.ghost()}>{modelValue}</span>
              </TooltipHint>{" "}
              · yours{" "}
            </span>
          ) : null}
          <span
            {...reachProps()}
            className={slots.base()}
            data-body={read.body ?? undefined}
            data-author={props.author}
            data-suggestion-author={props.suggestionAuthor}
            data-damage={props.damage || undefined}
            data-seam={read.seam ? "" : undefined}
            data-contest={read.contested ? "" : undefined}
            data-never={read.never ? "" : undefined}
            data-unsaved={
              read.unsaved === "pea"
                ? "pea"
                : read.unsaved === "human"
                  ? "human"
                  : read.unsaved === "unknown"
                    ? "unknown"
                    : undefined
            }
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
            <TooltipHint content="the value the model currently holds">
              <span className={slots.ghost()}>{modelValue}</span>
            </TooltipHint>
          ) : null}
          {transitions.map((t) => (
            <TooltipHint content={t.reason ?? TRANSITION[t.kind].says} key={t.kind}>
              <Verdict kind={t.kind} disabled={pending} onClick={() => fire(t)}>
                {t.kind}
              </Verdict>
            </TooltipHint>
          ))}
          {refusalNote != null ? (
            <TooltipHint content={`${refusalNote.message} — click to dismiss`}>
              <button type="button" className={slots.refusal()} onClick={() => setRefusal(null)}>
                {refusalNote.message}
              </button>
            </TooltipHint>
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
    </TooltipHint>
  );
}

/**
 * The cell-state key: grouped by axis, ordered by the cell's precedence. Every specimen is a real
 * `StateCell`, so the key cannot teach a treatment the table does not use. Mount it inside the
 * artifact frame of the thing it describes.
 */

export const cellStateKeyRecipe = tv({
  slots: {
    base: "grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-x-[18px] gap-y-[9px] border-t border-line on-recess px-2.5 pt-2 pb-[9px]",
    axis: "flex min-w-0 flex-col gap-[3px]",
    head: "flex items-baseline gap-[5px] border-b border-line pb-0.5",
    name: "t-small t-upper",
    asks: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap t-small face-mono text-ink-mute italic",
    item: "cell-key-values grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-[7px] t-small t-upper text-ink-2 [&_.dl-sq]:text-ink [&_.dl-cite]:text-ink",
  },
});

interface KeyAxis {
  axis: string;
  /** The question the axis answers, in the reader's words. */
  asks: string;
  items: { label: string; specimen: React.ReactNode }[];
}

/** In the order the eye needs them: who acted ▸ does the model agree ▸ how old ▸ can it be written. */
const AXES: readonly KeyAxis[] = [
  {
    axis: "event",
    asks: "who is holding an unsaved change?",
    items: [
      {
        label: "agent proposes — fold + green square",
        specimen: <StateCell value="2 hr" stage="proposed" />,
      },
      {
        label: "you edit — bold + your square",
        specimen: <StateCell value="36 in" stage="edit" />,
      },
    ],
  },
  {
    axis: "agreement",
    asks: "does the model hold the same value?",
    items: [
      {
        label: "the model disagrees",
        specimen: <StateCell value="1.75 in" agree="drift" modelValue="1.375 in" />,
      },
    ],
  },
  {
    axis: "freshness",
    asks: "how much do we know about it?",
    items: [
      { label: "stale read", specimen: <StateCell value="5.5 in" fresh="stale" /> },
      {
        label: "unverified — value never checked",
        specimen: <StateCell value="26 in" fresh="unverified" />,
      },
      { label: "never — nothing attempted yet", specimen: <StateCell value="—" fresh="never" /> },
    ],
  },
  {
    axis: "capability",
    asks: "can it be written at all?",
    items: [
      // One refusal rendering: `locked`, with `capReason` saying which refusal it is.
      {
        label: "locked — the reason says which refusal",
        specimen: <StateCell value="84 in" cap="locked" />,
      },
      {
        label: "seam — no element behind it",
        specimen: <StateCell value="412 sf" cap="nohome" />,
      },
    ],
  },
  {
    axis: "grounding",
    asks: "where did the number come from?",
    items: [
      {
        label: "citation — plain underline, on the footline",
        specimen: <StateCell value="2 hr" grounding={{ doc: "RFI-217", page: 2 }} />,
      },
    ],
  },
];

export function CellStateKey() {
  const slots = cellStateKeyRecipe();
  return (
    <div className={slots.base()}>
      {AXES.map((a) => (
        <div key={a.axis} className={slots.axis()}>
          <div className={slots.head()}>
            <span className={slots.name()}>{a.axis}</span>
            <span className={slots.asks()}>{a.asks}</span>
          </div>
          {a.items.map((it) => (
            <span key={it.label} className={slots.item()}>
              {it.specimen}
              <span>{it.label}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
