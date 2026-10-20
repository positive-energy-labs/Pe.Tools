/**
 * The one list item and table row (`as="tr"`): one height, one type rung, mono only from a column
 * or the meta slot. States are data attributes (cursor, selected, active, pending, failed), never
 * hues; a refusal is `aria-disabled` and greyed, its reason in a Tooltip (never drawn).
 * Painted in lang.css. A Row with `depth` is a tree node; `Tree` below nests them.
 */
import {
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";

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
        /** A tree row (row.tsx `Tree`): its nesting level from 0. The row indents one step per level and
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
  return <ListRow {...props} shared={shared} />;
}

/** The div row. A title the row cuts short is its own hint: measured on pointer entry, the full
 *  text rides the row's one Tooltip unless a refusal or a caller's hint already holds it. */
function ListRow({
  shared,
  ...props
}: Extract<RowProps, { as?: "div" }> & { shared: Record<string, unknown> }) {
  const [cut, setCut] = useState<string | null>(null);
  const slots = rowRecipe({ lines: props.lines ?? 1 });
  const fact = props.meta != null ? <span className="dl-row-fact">{props.meta}</span> : null;
  const tree = props.depth !== undefined;
  return (
    <TooltipHint content={props.refusal ?? props.title ?? cut}>
      <div
        {...shared}
        className={slots.base()}
        data-lines={props.lines !== 1 ? props.lines : undefined}
        data-depth={tree ? props.depth : undefined}
        aria-level={tree ? props.depth! + 1 : undefined}
        aria-expanded={tree ? props.expanded : undefined}
        style={tree ? ({ "--depth": props.depth } as CSSProperties) : undefined}
        onPointerEnter={(event) => {
          const title = event.currentTarget.querySelector<HTMLElement>(".dl-row-title");
          setCut(title && title.scrollWidth > title.clientWidth ? title.textContent : null);
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

/**
 * `<Tree>`: the one disclosure list. Nodes flatten to Rows that carry their depth; the Row draws
 * the chevron and lang.css the indent and guide lines. Keys on the tree: ↑ ↓ Home End move the
 * cursor, → opens (or steps into), ← closes (or steps to the parent), Enter picks. Open state is
 * the caller's when `open` is given, else the tree's own.
 */
/** What a caller draws for one node: the Row's slots and its own states. */
export type TreeRowParts = Omit<RowState, "cursor"> & {
  lead?: ReactNode;
  label: ReactNode;
  aside?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  title?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

export interface TreeProps<N> {
  roots: readonly N[];
  keyOf: (node: N) => string;
  childrenOf: (node: N) => readonly N[];
  row: (node: N) => TreeRowParts;
  "aria-label": string;
  /** Controlled open keys. */
  open?: ReadonlySet<string>;
  defaultOpen?: Iterable<string>;
  onOpenChange?: (open: Set<string>) => void;
  /** Controlled cursor by key (a linked pane's hover is the cursor). */
  cursor?: string | null;
  onCursorChange?: (key: string | null) => void;
  onPick?: (node: N) => void;
  /** Nothing in scope says so; a tree is never a blank. */
  empty: ReactNode;
  maxHeight?: string;
}

interface Flat<N> {
  node: N;
  key: string;
  depth: number;
  parent: string | null;
  branch: boolean;
}

export function Tree<N>(props: TreeProps<N>) {
  const { keyOf, childrenOf } = props;
  const treeId = useId();
  const [ownOpen, setOwnOpen] = useState<ReadonlySet<string>>(() => new Set(props.defaultOpen));
  const open = props.open ?? ownOpen;
  const [ownCursor, setOwnCursor] = useState<string | null>(null);
  const cursor = props.cursor !== undefined ? props.cursor : ownCursor;

  const rows = useMemo(() => {
    const out: Flat<N>[] = [];
    const walk = (nodes: readonly N[], depth: number, parent: string | null) => {
      for (const node of nodes) {
        const key = keyOf(node);
        const children = childrenOf(node);
        out.push({ node, key, depth, parent, branch: children.length > 0 });
        if (children.length && open.has(key)) walk(children, depth + 1, key);
      }
    };
    walk(props.roots, 0, null);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodes are identified by key
  }, [props.roots, open]);

  const setOpen = (key: string, on: boolean) => {
    const next = new Set(open);
    if (on) next.add(key);
    else next.delete(key);
    if (props.open === undefined) setOwnOpen(next);
    props.onOpenChange?.(next);
  };
  const setCursor = (key: string | null) => {
    if (key === cursor) return;
    if (props.cursor === undefined) setOwnCursor(key);
    props.onCursorChange?.(key);
  };
  const rowId = (key: string) => `${treeId}-${key.replace(/[^\w-]/g, "_")}`;
  const moveTo = (key: string | undefined) => {
    if (key === undefined) return;
    setCursor(key);
    document.getElementById(rowId(key))?.scrollIntoView?.({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = rows.findIndex((row) => row.key === cursor);
    const here = rows[at];
    switch (event.key) {
      case "ArrowDown":
        moveTo(rows[Math.min(rows.length - 1, at + 1)]?.key);
        break;
      case "ArrowUp":
        moveTo(rows[Math.max(0, at - 1)]?.key);
        break;
      case "Home":
        moveTo(rows[0]?.key);
        break;
      case "End":
        moveTo(rows.at(-1)?.key);
        break;
      case "ArrowRight":
        if (!here?.branch) return;
        if (open.has(here.key)) moveTo(rows[at + 1]?.key);
        else setOpen(here.key, true);
        break;
      case "ArrowLeft":
        if (!here) return;
        if (here.branch && open.has(here.key)) setOpen(here.key, false);
        else moveTo(here.parent ?? undefined);
        break;
      case "Enter":
        if (here) props.onPick?.(here.node);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      role="tree"
      aria-label={props["aria-label"]}
      aria-activedescendant={cursor ? rowId(cursor) : undefined}
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto outline-none"
      style={{ maxHeight: props.maxHeight }}
      onKeyDown={onKeyDown}
    >
      {rows.length === 0 ? (
        <div className="dl-row" role="status" data-pending="">
          <span className="dl-row-label">{props.empty}</span>
        </div>
      ) : (
        rows.map(({ node, key, depth, branch }) => (
          <Row
            key={key}
            {...props.row(node)}
            id={rowId(key)}
            role="treeitem"
            data-key={key}
            depth={depth}
            expanded={branch ? open.has(key) : undefined}
            onToggle={() => setOpen(key, !open.has(key))}
            cursor={key === cursor}
            onMouseMove={() => setCursor(key)}
            onClick={() => {
              setCursor(key);
              props.onPick?.(node);
            }}
          />
        ))
      )}
    </div>
  );
}
