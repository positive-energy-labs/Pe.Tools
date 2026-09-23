/**
 * ROW — the one list item, and the one table row (ix-list design; census R2, R3, R8, R10, R11).
 *
 * Every list-shaped thing draws its items with this: sidebar threads, palette hits, the head
 * ladder, combobox options, the slash menu, member and schedule rails, route lists, and (`as="tr"`) table
 * rows. One recipe, one height (`--item-h`), one type rung (`t-small`, sans; mono comes from a
 * column or the meta slot, never a call site).
 *
 * STATES ARE DATA, NEVER HUES. `cursor` (where the keys are), `selected` (in the set), `active`
 * (the open or current item) and `pending` / `failed` are separate attributes, painted in
 * lang.css: the cursor is the veil, selection the one select fill, active a rail mark, pending
 * quiet italic, failed the caution squiggle. A refusal is `aria-disabled` plus its reason, said
 * in the row, not a greyed guess.
 */
import type { ReactNode } from "react";

import { tv } from "#/lib/tv";

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
    lines: { 1: {}, 2: {} },
  },
  defaultVariants: { lines: 1 },
});

export interface RowState {
  /** Where the keyboard is. Not the selection. */
  cursor?: boolean;
  /** In the selected set. */
  selected?: boolean;
  /** The open, current or bound item (the thread you are in, the level you are on). */
  active?: boolean;
  pending?: boolean;
  failed?: boolean;
  /** Present, the row refuses picks and says why. */
  refusal?: string | null;
}

type RowProps = RowState & {
  id?: string;
  role?: string;
  title?: string;
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
        /** A second line: only with `lines={2}`, which is two item heights. */
        sub?: ReactNode;
        lines?: 1 | 2;
        meta?: ReactNode;
        /** Row verbs: revealed on hover or focus-within at zero footprint; never the pick. */
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
});

export function Row(props: RowProps) {
  const { cursor, selected, active, pending, failed, refusal, id, role, onClick, onMouseMove } =
    props;
  const states = rowStateProps({ cursor, selected, active, pending, failed, refusal });
  const shared = {
    id,
    role,
    onClick: refusal ? undefined : onClick,
    onMouseMove,
    onMouseEnter: props.onMouseEnter,
    onMouseLeave: props.onMouseLeave,
    "data-key": props["data-key"],
    title: refusal ?? props.title,
    ...states,
  };
  if (props.as === "tr") {
    const slots = rowRecipe();
    return (
      <tr
        {...shared}
        ref={props.ref}
        className={slots.base({ className: props.className })}
        data-row="tr"
      >
        {props.children}
      </tr>
    );
  }
  const slots = rowRecipe({ lines: props.lines ?? 1 });
  return (
    <div {...shared} className={slots.base()} data-lines={props.lines === 2 ? 2 : undefined}>
      {props.lead != null ? <span className={slots.lead()}>{props.lead}</span> : null}
      <span className={slots.label()}>
        {props.label}
        {props.lines === 2 && props.sub != null ? (
          <span className={slots.sub()}>{props.sub}</span>
        ) : null}
      </span>
      {refusal ? <span className={slots.meta()}>{refusal}</span> : null}
      {props.meta != null ? <span className={slots.meta()}>{props.meta}</span> : null}
      {props.actions != null ? (
        <span className={slots.actions()} onClick={(event) => event.stopPropagation()}>
          {props.actions}
        </span>
      ) : null}
    </div>
  );
}

/** A group's section head, sticky inside its scroll container (R4). */
export function RowGroupHead({ label, count }: { label: ReactNode; count?: number }) {
  return (
    <div className="dl-row-head" role="presentation" data-surface="recess">
      {label}
      {count != null ? <span className="dl-row-meta">{count}</span> : null}
    </div>
  );
}
