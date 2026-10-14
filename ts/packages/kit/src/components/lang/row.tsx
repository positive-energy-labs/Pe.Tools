/**
 * The one list item and table row (`as="tr"`): one height, one type rung, mono only from a column
 * or the meta slot. States are data attributes (cursor, selected, active, pending, failed), never
 * hues; a refusal is `aria-disabled` and greyed, its reason in a Tooltip (never drawn).
 * Painted in lang.css.
 */
import type { ReactNode } from "react";

import { tv } from "../../lib/tv";
import { TooltipHint } from "./tooltip";

import "./lang.css";

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
  /** Where the keyboard is. Not the selection. */
  cursor?: boolean;
  /** In the selected set. */
  selected?: boolean;
  checked?: boolean | "mixed";
  /** The open, current or bound item (the thread you are in, the level you are on). */
  active?: boolean;
  pending?: boolean;
  failed?: boolean;
  /** Present, the row refuses picks and is greyed; the reason is its tooltip, not drawn text. */
  refusal?: string | null;
}

type RowProps = RowState & {
  id?: string;
  role?: string;
  title?: string;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLElement>;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLElement>;
  onDragOver?: React.DragEventHandler<HTMLElement>;
  onDrop?: React.DragEventHandler<HTMLElement>;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseMove?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  "data-key"?: string;
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
        /** Target and time above a navigation item's title; three lines reserve one item height each. */
        eyebrow?: ReactNode;
        /** The row's state (an activity, an age, a mark): the trailing slot of the first line. */
        meta?: ReactNode;
        /** Row verbs (usually one menu): they take the meta slot in place on hover, keyboard
         *  focus or an open menu; without hover, a tap on the slot opens them. Never the pick. */
        actions?: ReactNode;
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
  "data-cursor": state.cursor ? "" : undefined,
  "data-selected": state.selected ? "" : undefined,
  "data-active": state.active ? "" : undefined,
  "data-pending": state.pending ? "" : undefined,
  "data-failed": state.failed ? "" : undefined,
  "aria-disabled": state.refusal ? true : undefined,
  "aria-selected": state.selected === undefined ? undefined : state.selected,
  "aria-checked": state.checked,
});

export function Row(props: RowProps) {
  const {
    cursor,
    selected,
    checked,
    active,
    pending,
    failed,
    refusal,
    id,
    role,
    onClick,
    onMouseMove,
  } = props;
  const states = rowStateProps({ cursor, selected, checked, active, pending, failed, refusal });
  const shared = {
    id,
    role,
    onClick: refusal ? undefined : onClick,
    onMouseMove,
    onMouseEnter: props.onMouseEnter,
    onMouseLeave: props.onMouseLeave,
    "data-key": props["data-key"],
    tabIndex: props.tabIndex,
    onKeyDown: props.onKeyDown,
    onDoubleClick: props.onDoubleClick,
    onContextMenu: props.onContextMenu,
    draggable: props.draggable,
    onDragStart: props.onDragStart,
    onDragOver: props.onDragOver,
    onDrop: props.onDrop,
    ...states,
  };
  if (props.as === "tr") {
    const slots = rowRecipe();
    return (
      <TooltipHint content={refusal ?? props.title}>
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
  const slots = rowRecipe({ lines: props.lines ?? 1 });
  const fact = props.meta != null ? <span className="dl-row-fact">{props.meta}</span> : null;
  return (
    <TooltipHint content={refusal ?? props.title}>
      <div
        {...shared}
        className={slots.base()}
        data-lines={props.lines !== 1 ? props.lines : undefined}
      >
        {props.lead != null ? <span className={slots.lead()}>{props.lead}</span> : null}
        <span className={slots.label()}>
          {props.lines === 3 ? <span className="dl-row-eyebrow">{props.eyebrow}</span> : null}
          {/* The first line: the title, then one trailing slot where the state and the verbs
            share a cell (lang.css), so a sub line runs the full width under it. */}
          <span className="dl-row-line">
            <span className="dl-row-title">
              {props.label}
              {props.aside != null ? <span className="dl-row-aside">{props.aside}</span> : null}
            </span>
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
