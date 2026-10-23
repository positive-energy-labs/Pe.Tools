/**
 * The one list item and table row (`as="tr"`): one height, one type rung, mono only from a column
 * or the meta slot. States are data attributes (cursor, selected, active, pending, failed), never
 * hues; a refusal is `aria-disabled` and greyed, its reason in a Tooltip (never drawn).
 * Painted in lang.css. A Row with `depth` is a tree node; ListView nests them.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, Flame } from "lucide-react";

import { tv } from "../../lib/tv";
import { TooltipHint } from "./tooltip";
import type { StateCellProps } from "./cell-state";

import "./lang.css";

const landings = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** A named arrival scrolls nearest and marks once; focus is reserved for editing destinations. */
export function land(el: HTMLElement, { focus = false }: { focus?: boolean } = {}) {
  clearTimeout(landings.get(el));
  el.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  if (focus)
    (el.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]") ?? el).focus({
      preventScroll: true,
    });
  el.removeAttribute("data-landed");
  // Restart the CSS animation even for two consecutive arrivals on the same element.
  void el.offsetWidth;
  el.setAttribute("data-landed", "");
  const duration =
    getComputedStyle(el).getPropertyValue("--motion-land").trim() ||
    getComputedStyle(document.documentElement).getPropertyValue("--motion-land").trim();
  const ms = parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
  landings.set(
    el,
    setTimeout(
      () => {
        el.removeAttribute("data-landed");
        landings.delete(el);
      },
      Number.isFinite(ms) ? ms : 0,
    ),
  );
}

export const rowRecipe = tv({
  slots: {
    base: "dl-row",
    lead: "dl-row-lead",
    label: "dl-row-label",
    sub: "dl-row-sub",
    meta: "dl-row-meta",
    actions: "dl-row-actions",
  },
  variants: {
    lines: { 1: {}, 2: {}, 3: {} },
  },
  defaultVariants: { lines: 1 },
});

export interface RowState {
  stage?: StateCellProps["stage"];
  stagedBy?: StateCellProps["stagedBy"];
  /** Where the keyboard is. Not the selection. */
  cursor?: boolean;
  /** In the selected set. */
  selected?: boolean;
  checked?: boolean | "mixed";
  /** The open, current or bound item (the thread you are in, the level you are on). */
  active?: boolean;
  pending?: boolean;
  failed?: boolean;
  /** Critical damage (I2): the row blocks the result (a price, a write) until the person fixes it.
   *  The word says what it blocks ("no price", "no airflow"). It burns on the row itself: an alarm
   *  edge with the 3D burn's heartbeat, a faint wash, and the flame mark with the word (a table row
   *  says the word in its hint). Rare and loud: calm rows never carry it. */
  damage?: string | null;
  /** Present, the row refuses picks and is greyed; the reason is its tooltip, not drawn text. */
  refusal?: string | null;
  /** The Revit elements the row stands for: right-click or BX shows them in Revit (the app's element menu). */
  revitIds?: readonly number[];
  /** Captured native references; the app verifies kind and expected identity before dispatch. */
  revitRefs?: readonly RevitElementReference[];
}

/** Structural projection of native element handles; kit owns no document resolution. */
export type RevitElementReference = {
  elementId: number | null;
  uniqueId?: string | null;
  documentKey?: string;
  kind?: string;
  linkInstanceIds?: readonly number[];
};

/** The attribute the app's element menu reads: put it on any element that stands for Revit elements. */
export const revitTarget = (
  ids: readonly number[] | null | undefined,
  refs?: readonly RevitElementReference[],
) => ({
  "data-revit-ids": ids?.length ? ids.join(",") : undefined,
  "data-revit-refs": refs?.length ? JSON.stringify(refs) : undefined,
});

export type RowProps = RowState & {
  id?: string;
  role?: string;
  title?: string;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLElement>;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLElement>;
  onDragEnd?: React.DragEventHandler<HTMLElement>;
  onDragEnter?: React.DragEventHandler<HTMLElement>;
  onDragLeave?: React.DragEventHandler<HTMLElement>;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseMove?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  "data-key"?: string;
  "data-index"?: number;
} & (
    | {
        as?: "div";
        lead?: ReactNode;
        label: ReactNode;
        /** One short fact after the title on its line, in ink-2 (mono when it is a key); it
         *  truncates before the title does. */
        aside?: ReactNode;
        /** A second line: only with `lines={2}`, which is two item heights. */
        sub?: ReactNode;
        lines?: 1 | 2 | 3;
        /** Let titles and secondary content reflow; the row grows only as much as it needs. */
        wrap?: boolean;
        /** Target and time above a navigation item's title; three lines reserve one item height each. */
        eyebrow?: ReactNode;
        /** A short fact (count, type, state, shortcut, time): the trailing slot of the first line.
         * Explanatory prose belongs in the list's optional description, never repeated here. */
        meta?: ReactNode;
        /** A measure in the trailing slot fills the space after the title. */
        metaFill?: boolean;
        /** Row verbs (usually one menu): they take the meta slot in place on hover, keyboard
         *  focus or an open menu; without hover, a tap on the slot opens them. Never the pick. */
        actions?: ReactNode;
        /** A measure below the row, inside its measured virtual extent. */
        band?: ReactNode;
        /** A tree row: its nesting level from 0. The row indents one step per level and
         *  draws its ancestors' guide lines (lang.css); it is the only indent a list may draw. */
        depth?: number;
        /** With `depth`: open or closed draws the chevron, absent is a leaf (its space is held). */
        expanded?: boolean;
        /** The chevron's press: open or close, never the pick. */
        onToggle?: () => void;
        children?: never;
      }
    | {
        as: "tr";
        children: ReactNode;
        className?: string;
        ref?: React.Ref<HTMLTableRowElement>;
      }
  );

/** The states as attributes: the one place a row's state becomes DOM. */
const rowStateProps = (state: RowState) => ({
  "data-stage": state.stage,
  "data-staged-by": state.stage && state.stage !== "clean" ? (state.stagedBy ?? "pea") : undefined,
  "data-cursor": state.cursor ? "" : undefined,
  "data-selected": state.selected ? "" : undefined,
  "data-active": state.active ? "" : undefined,
  "data-pending": state.pending ? "" : undefined,
  "data-failed": state.failed ? "" : undefined,
  "data-damage": state.damage || undefined,
  "aria-disabled": state.refusal ? true : undefined,
  "aria-selected": state.selected === undefined ? undefined : state.selected,
  "aria-checked": state.checked,
  ...revitTarget(state.revitIds, state.revitRefs),
});

export function Row(props: RowProps) {
  const {
    cursor,
    selected,
    checked,
    active,
    pending,
    failed,
    damage,
    refusal,
    revitIds,
    revitRefs,
    id,
    role,
    onClick,
    onMouseMove,
  } = props;
  const states = rowStateProps({
    stage: props.stage,
    stagedBy: props.stagedBy,
    cursor,
    selected,
    checked,
    active,
    pending,
    failed,
    damage,
    refusal,
    revitIds,
    revitRefs,
  });
  const shared = {
    id,
    role,
    onClick: refusal ? undefined : onClick,
    onMouseMove,
    onMouseEnter: props.onMouseEnter,
    onMouseLeave: props.onMouseLeave,
    "data-key": props["data-key"],
    "data-index": props["data-index"],
    tabIndex: props.tabIndex,
    onKeyDown: props.onKeyDown,
    onDoubleClick: props.onDoubleClick,
    onContextMenu: props.onContextMenu,
    draggable: props.draggable,
    onDragStart: props.onDragStart,
    onDragEnd: props.onDragEnd,
    onDragEnter: props.onDragEnter,
    onDragLeave: props.onDragLeave,
    onDragOver: props.onDragOver,
    onDrop: props.onDrop,
    ...states,
  };
  if (props.as === "tr") {
    const slots = rowRecipe();
    return (
      <TooltipHint
        content={[damage, refusal ?? props.title].filter(Boolean).join(" · ") || undefined}
      >
        <tr
          {...shared}
          ref={props.ref}
          className={slots.base({ className: props.className })}
          data-row="tr"
        >
          {props.children}
        </tr>
      </TooltipHint>
    );
  }
  const row = <ListRow {...props} shared={shared} />;
  return props.band != null ? (
    <div data-list-row-band="">
      {row}
      {props.band}
    </div>
  ) : (
    row
  );
}

/** The div row. A title or fact the row cuts short is its own hint: measured on pointer entry, the
 *  full text rides the row's one Tooltip unless a refusal or a caller's hint already holds it. */
function ListRow({
  shared,
  ...props
}: Extract<RowProps, { as?: "div" }> & { shared: Record<string, unknown> }) {
  const [cut, setCut] = useState<string | null>(null);
  const slots = rowRecipe({ lines: props.lines ?? 1 });
  const fact = props.meta != null ? <span className="dl-row-fact">{props.meta}</span> : null;
  const tree = props.depth !== undefined;
  const title = (
    <span className="dl-row-title">
      {props.label}
      {props.aside != null ? <span className="dl-row-aside">{props.aside}</span> : null}
    </span>
  );
  return (
    // Beside the list, never above or below: a row's hint covered its neighbour row.
    <TooltipHint content={props.refusal ?? props.title ?? cut} side="left" keep>
      <div
        {...shared}
        className={slots.base()}
        data-meta-fill={props.metaFill ? "" : undefined}
        data-wrap={props.wrap ? "" : undefined}
        data-lines={props.lines !== 1 ? props.lines : undefined}
        data-depth={tree ? props.depth : undefined}
        aria-level={tree ? props.depth! + 1 : undefined}
        aria-expanded={tree ? props.expanded : undefined}
        style={tree ? ({ "--depth": props.depth } as CSSProperties) : undefined}
        onPointerEnter={(event) => {
          const cutText = (selector: string) => {
            const el = event.currentTarget.querySelector<HTMLElement>(selector);
            return el && el.scrollWidth > el.clientWidth ? el.textContent : null;
          };
          const title = cutText(".dl-row-title");
          const fact = cutText(".dl-row-fact");
          setCut(title || fact ? [title, fact].filter(Boolean).join(" · ") : null);
        }}
      >
        {tree ? (
          <span
            className="dl-row-twist"
            aria-hidden
            onClick={(event) => {
              if (props.expanded === undefined) return;
              event.stopPropagation();
              props.onToggle?.();
            }}
          >
            {props.expanded !== undefined ? <ChevronRight /> : null}
          </span>
        ) : null}
        {props.lead != null ? <span className={slots.lead()}>{props.lead}</span> : null}
        <span className={slots.label()}>
          {props.lines === 3 ? <span className="dl-row-eyebrow">{props.eyebrow}</span> : null}
          {/* The first line: the title, then one trailing slot where the state and the verbs
            share a cell (lang.css), so a sub line runs the full width under it. */}
          <span className="dl-row-line">
            {props.damage ? (
              // The word never truncates: the title yields beside it.
              <span className="dl-row-burn">
                {title}
                <span className="dl-row-damage">
                  <Flame aria-hidden />
                  {props.damage}
                </span>
              </span>
            ) : (
              title
            )}
            {fact || props.actions != null ? (
              <span className={slots.meta()}>
                {fact}
                {props.actions != null ? (
                  <span className={slots.actions()} onClick={(event) => event.stopPropagation()}>
                    {props.actions}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
          {props.lines !== 1 && props.sub != null ? (
            <span className={slots.sub()}>{props.sub}</span>
          ) : null}
        </span>
      </div>
    </TooltipHint>
  );
}

/** A group's section head, sticky inside its scroll container, drawn as the roster's shelf head:
 *  label, quiet count, a hairline to the edge, no fill. A group named with blank space is an
 *  unnamed section — a menu's verb cluster — and draws as a rule, not a head. */
export function RowGroupHead({ label, count }: { label: ReactNode; count?: number }) {
  if (typeof label === "string" && label.trim() === "")
    return <div className="dl-row-sep" role="separator" />;
  return (
    <div className="dl-row-head" role="presentation">
      <span>{label}</span>
      {count != null ? <span data-slot="count">{count}</span> : null}
      <span data-slot="rule" aria-hidden />
    </div>
  );
}
