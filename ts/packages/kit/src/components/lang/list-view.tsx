import type { Tone } from "../../lib/token";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
  type RefObject,
} from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

import { Button } from "./button";
import {
  overscanRows,
  VIRTUAL_FROM,
  virtualSpans,
  type ListController,
  type ListItem,
} from "./collection";
import {
  assertScrollOwner,
  domSpans,
  Scroll,
  useProjection,
  useRowHeight,
  useScroller,
  type Mark,
} from "./scroll";
import { EmptyState } from "./empty";
import { ScopeGestures } from "../../keys";
import { OutcomeLine } from "./outcome";
import { StatusLine } from "./list-popup";
import { ListBar } from "./list-search";
export { useSearchKey, type SearchKeyOwner } from "./list-search";
import { land } from "./land";
import { Row, type RowProps } from "./row";
import "./lang.css";

export type ListRowParts = Omit<
  Extract<RowProps, { as?: "div" }>,
  "id" | "role" | "cursor" | "selected" | "onClick" | "depth" | "expanded" | "onToggle"
>;

/** Higher priorities yield first; CSS reserves the title before sizing trailing facts. */
export function listColumns<K extends string>(
  columns: Record<K, { kind: "number" | "bar" | "mark"; priority: 0 | 1 | 2 }>,
) {
  return Object.fromEntries(
    Object.entries<{ kind: string; priority: number }>(columns).map(([key, column]) => [
      key,
      { "data-list-column": column.kind, "data-priority": column.priority },
    ]),
  ) as Record<K, { "data-list-column": string; "data-priority": number }>;
}

function pressSection(
  head: HTMLButtonElement,
  closed: boolean,
  toggle: () => void,
  scroller: HTMLElement | null,
) {
  const home = head.previousElementSibling as HTMLElement | null;
  if (!home) return;
  const stuck = Math.abs(head.getBoundingClientRect().top - home.getBoundingClientRect().top) > 1;
  if (!stuck || closed) toggle();
  // A stuck head sits at its sticky top, so the gap to its home is the distance to scroll.
  if (stuck && scroller)
    requestAnimationFrame(() =>
      scroller.scrollTo({
        top:
          scroller.scrollTop + home.getBoundingClientRect().top - head.getBoundingClientRect().top,
        behavior: "smooth",
      }),
    );
}

export interface ListViewProps<T, Sort extends string = string> {
  list: ListController<T, Sort>;
  row: (item: T) => ListRowParts;
  "aria-label": string;
  empty: { message: string; exit: string };
  /** Omit when the surrounding `Scroll` (a pane body) already owns scrolling. */
  maxHeight?: string;
  /** What a row says on the scrollbar beyond its damage, selection, hits and heads. */
  projection?: (item: T) => Pick<Mark, "weight" | "tone">;
  columns?: { label: ReactNode; meta?: ReactNode };
  /** Open state is the same data-owned `open` used for tree expansion. */
  detail?: (item: T) => ReactNode;
  sectionProps?: (
    section: ListController<T, Sort>["sections"][number],
  ) => Pick<
    HTMLAttributes<HTMLElement>,
    "onDragOver" | "onDrop" | "onDragEnter" | "onDragLeave" | "onContextMenu"
  > & { "data-dim"?: boolean; "data-tone"?: Tone };
}

export function ListView<T, Sort extends string = string>(props: ListViewProps<T, Sort>) {
  return props.maxHeight ? (
    <Scroll maxHeight={props.maxHeight} className="w-full">
      <ListRenderer {...props} />
    </Scroll>
  ) : (
    <ListRenderer {...props} />
  );
}

/** Small collections share rows, keys and sections without search chrome or virtualization. */
export function PlainList<T, Sort extends string = string>(props: ListViewProps<T, Sort>) {
  return <ListRenderer {...props} plain />;
}

function ListRenderer<T, Sort extends string>(props: ListViewProps<T, Sort> & { plain?: boolean }) {
  const { list, row, empty, maxHeight, detail } = props;
  const searching = !props.plain && (list.total > 7 || list.filtering || !!list.state.sort);
  const [headroom, setHeadroom] = useState(0);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const owned = useScroller();
  // The scroller is the `Scroll` context, never an ancestor walk; a plain list outside one
  // (a popup body) measures against itself.
  const scroller = owned ?? (props.plain ? root : null);
  useLayoutEffect(() => {
    list.setTarget(root);
    return () => list.setTarget(null);
  }, [root, list.setTarget]);
  useLayoutEffect(() => {
    if (props.plain || !root || process.env.NODE_ENV === "production") return;
    assertScrollOwner(root, owned, `ListView "${props["aria-label"]}"`);
  }, [root, owned, props.plain]);
  useProjection(
    () =>
      root && scroller
        ? domSpans(
            scroller,
            root.querySelectorAll(":scope > section > [data-list-section-home]"),
            () => ({ tick: true }),
          )
        : [],
    list.sections,
  );
  useLayoutEffect(() => {
    if (!root || !scroller) return;
    const padding = scroller.style.scrollPaddingTop;
    const reservation = scroller.style.getPropertyValue("--list-headroom");
    const bar = root.querySelector<HTMLElement>(":scope > [data-list-bar]");
    const heads = root.querySelectorAll<HTMLElement>(":scope > section > [data-list-section-head]");
    const measure = () => {
      const search = bar?.offsetHeight ?? 0;
      const item = heads[0]?.offsetHeight ?? 0;
      const stack = scroller.clientHeight - search - heads.length * item >= item;
      const reserved = search + (stack ? heads.length : Math.min(1, heads.length)) * item;
      root.toggleAttribute("data-list-single", !stack);
      root.style.setProperty("--list-stack", stack ? "1" : "0");
      root.style.setProperty("--list-search-height", `${search}px`);
      for (const element of new Set([root, scroller]))
        element.style.setProperty("--list-headroom", `${reserved}px`);
      scroller.style.scrollPaddingTop = "var(--list-headroom)";
      setHeadroom(reserved);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const element of [scroller, ...(bar ? [bar] : []), ...heads]) observer?.observe(element);
    return () => {
      observer?.disconnect();
      scroller.style.scrollPaddingTop = padding;
      scroller.style.setProperty("--list-headroom", reservation);
    };
  }, [root, scroller, list.sections, searching, list.collection.reading]);
  // N1: only a key move or named reveal moves the view, never refresh, hover or resize.
  const request = `${list.collection.steer}:${list.revealRequest?.serial ?? 0}`;
  const served = useRef("0:0");
  const landed = useRef(0);
  useLayoutEffect(() => landRequest(list, landed));
  useLayoutEffect(() => {
    if (
      (!props.plain && list.total >= VIRTUAL_FROM) ||
      served.current === request ||
      !list.collection.cursor
    )
      return;
    const revealing = served.current.split(":")[1] !== request.split(":")[1];
    served.current = request;
    if (revealing) return;
    land(document.getElementById(list.collection.rowProps(list.collection.cursor).id));
  }, [request]);
  const label = props["aria-label"];
  // Rows render through this ref, so a memoized row that skipped a render still acts on today's list.
  const live = useRef(list);
  live.current = list;
  return (
    <div
      ref={setRoot}
      {...list.collection.listProps}
      role={list.tree ? "tree" : "listbox"}
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={list.collection.inputProps["aria-activedescendant"]}
      data-list-view=""
      className={`relative min-h-0 min-w-0 w-full${maxHeight ? "" : " shrink-0"}`}
    >
      <ScopeGestures
        gestures={[
          { pointer: "click", label: "select the row" },
          { pointer: "hover", label: "move the cursor" },
        ]}
      />
      {searching ? <ListBar list={list} label={label} /> : null}
      {props.columns ? (
        <div className="dl-row-colhead" role="presentation" data-tree-columns="">
          <span className="dl-row-colhead-label">{props.columns.label}</span>
          {props.columns.meta != null ? (
            <span className="dl-row-colhead-meta">{props.columns.meta}</span>
          ) : null}
        </div>
      ) : null}
      {!searching && list.collection.reading === "pending" && list.total ? (
        <div data-list-bar="">
          <OutcomeLine kind="busy" label="reading…" />
        </div>
      ) : null}
      {list.collection.reading === "failed" ? (
        <StatusLine tone="caution">{list.failure ?? "read failed"}</StatusLine>
      ) : list.collection.reading === "pending" && !list.total ? (
        <StatusLine>reading…</StatusLine>
      ) : null}
      {!list.total && list.collection.reading === "ready" ? (
        <EmptyState story="scope" exit={empty.exit}>
          {empty.message}
        </EmptyState>
      ) : list.total && !list.shown ? (
        <div role="status">
          <EmptyState story="filter" exit="Clear the search to see all rows">
            {list.refusal ? "Search cannot be applied" : `No matching ${label}`}
          </EmptyState>
        </div>
      ) : null}
      {list.sections.map((section, index) => (
        <section
          key={section.key}
          {...props.sectionProps?.(section)}
          data-list-section=""
          aria-label={section.label || label}
        >
          <span data-list-section-home="" aria-hidden />
          {section.label ? (
            <button
              type="button"
              data-list-section-head=""
              data-surface="artifact"
              aria-expanded={!section.closed}
              aria-disabled={!section.collapsible || undefined}
              onClick={(event) => {
                if (section.collapsible)
                  pressSection(
                    event.currentTarget,
                    section.closed,
                    () => list.toggleSection(section.key),
                    scroller,
                  );
              }}
              style={{
                top: `calc(var(--list-search-height, 0px) + var(--item-h) * ${index} * var(--list-stack, 1))`,
              }}
            >
              <ChevronRight aria-hidden />
              <span>{section.label}</span>
              <span className="face-mono">{section.count}</span>
              {section.staged ? <span className="face-mono">{section.staged} staged</span> : null}
              <span data-slot="rule" aria-hidden />
            </button>
          ) : null}
          {!section.closed ? (
            <SectionBody
              list={list}
              plain={props.plain}
              live={live}
              rows={section.rows}
              sectionKey={section.key}
              row={row}
              projection={props.projection}
              scroller={scroller}
              headroom={headroom}
              detail={detail}
              request={request}
              served={served}
              landed={landed}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}

type SectionBodyProps<T, Sort extends string> = {
  plain?: boolean;
  sectionKey: string;
  list: ListController<T, Sort>;
  projection?: (item: T) => Pick<Mark, "weight" | "tone">;
  live: RefObject<ListController<T, Sort>>;
  rows: readonly ListItem<T>[];
  row: (item: T) => ListRowParts;
  scroller: HTMLElement | null;
  headroom: number;
  detail?: (item: T) => ReactNode;
  /** The latest scroll request (key move or reveal) and the last one a body honoured. */
  request: string;
  served: RefObject<string>;
  landed: RefObject<number>;
};

/**
 * Every row's mark, from item data only: a projection never builds a row (its JSX and verbs).
 * Damage a route draws only through `row` reaches the scrollbar through `projection` tone.
 */
function markOf<T, Sort extends string>(
  list: ListController<T, Sort>,
  item: ListItem<T>,
  projection?: (item: T) => Pick<Mark, "weight" | "tone">,
): Mark {
  const extra = projection?.(item.item);
  const behavior = list.collection.rowProps(item.key);
  return {
    tone: item.damage ? "alarm" : extra?.tone,
    weight: extra?.weight,
    tick: item.branch,
    hit: item.hit,
    selected: behavior.selected || behavior.cursor,
  };
}

/** Re-project when what rows say could have changed; positions are read fresh at project time. */
function useMarkVersion<T, Sort extends string>(
  props: Pick<SectionBodyProps<T, Sort>, "list" | "rows" | "projection">,
) {
  const { list, rows, projection } = props;
  const selected = list.state.selected.join("\u0000");
  const cursor = list.collection.cursor;
  const open = list.state.open.join("\u0000");
  return useMemo(() => ({}), [rows, projection, selected, cursor, open, list.filtering]);
}

function SectionBody<T, Sort extends string>(props: SectionBodyProps<T, Sort>) {
  if (!props.plain && props.list.total >= VIRTUAL_FROM) return <VirtualSectionBody {...props} />;
  return <PlainSectionBody {...props} />;
}

function PlainSectionBody<T, Sort extends string>(props: SectionBodyProps<T, Sort>) {
  const body = useRef<HTMLDivElement>(null);
  const { list, rows, projection, scroller } = props;
  const version = useMarkVersion(props);
  useProjection(() => {
    if (props.plain || !body.current || !scroller) return [];
    const byKey = new Map(rows.map((item) => [item.key, item]));
    return domSpans(scroller, body.current.querySelectorAll(":scope > [data-key]"), (el) => {
      const item = byKey.get((el as HTMLElement).dataset.key ?? "");
      return item ? markOf(list, item, projection) : {};
    });
  }, version);
  return (
    <div ref={body} data-list-body="" role="presentation">
      {props.rows.map((item) => (
        <ListItemView
          key={item.key}
          {...rowState(props.list, item)}
          live={props.live}
          item={item}
          row={props.row}
          detail={props.detail}
        />
      ))}
    </div>
  );
}

function rowState<T, Sort extends string>(list: ListController<T, Sort>, item: ListItem<T>) {
  const behavior = list.collection.rowProps(item.key);
  return {
    cursor: behavior.cursor,
    selected: behavior.selected,
    expanded: list.state.open.includes(item.key),
    filtering: list.filtering,
    tree: list.tree,
    stage: list.stageOf?.(item.item),
    refusal: list.refusalOf?.(item.item),
  };
}

type ListItemViewProps<T, Sort extends string> = Pick<
  SectionBodyProps<T, Sort>,
  "live" | "row" | "detail"
> &
  ReturnType<typeof rowState<T, Sort>> & { item: ListItem<T> };

function ListItemViewInner<T, Sort extends string>({
  live,
  item,
  row,
  detail,
  cursor,
  selected,
  expanded,
  filtering,
  tree,
  stage,
  refusal,
}: ListItemViewProps<T, Sort>) {
  const parts = row(item.item);
  const content = detail?.(item.item);
  const { id } = live.current.collection.rowProps(item.key);
  return (
    <>
      <Row
        {...parts}
        revit={parts.revit ?? item.revit}
        damage={parts.damage ?? item.damage}
        id={id}
        data-key={item.key}
        cursor={cursor}
        selected={selected}
        onClick={(event) => {
          const target = event.target as Element;
          if (
            !event.currentTarget.contains(target) ||
            target.closest(
              "button, a, input, select, textarea, [role=button], [contenteditable=true]",
            )
          )
            return;
          live.current.collection.rowProps(item.key).onClick(event);
        }}
        onMouseMove={() => {
          live.current.collection.rowProps(item.key).onMouseMove();
          parts.onMouseMove?.();
        }}
        role={tree ? "treeitem" : "option"}
        stage={stage ?? parts.stage}
        refusal={refusal ?? parts.refusal}
        depth={tree ? item.depth : content != null ? 0 : undefined}
        expanded={item.branch ? expanded || filtering : content != null ? expanded : undefined}
        onToggle={() => live.current.toggleOpen(item.key)}
        actions={
          content != null ? (
            <>
              {parts.actions}
              <Button
                label={`${expanded ? "Close" : "Open"} details`}
                icon={expanded ? ChevronUp : ChevronDown}
                onClick={() => live.current.toggleOpen(item.key)}
              />
            </>
          ) : (
            parts.actions
          )
        }
      />
      {expanded && content != null ? <div data-list-detail="">{content}</div> : null}
    </>
  );
}

/** Stable row/detail callbacks let cursor and selection redraw only the rows they changed. */
const ListItemView = memo(
  ListItemViewInner,
  (a, b) =>
    a.item.key === b.item.key &&
    a.item.item === b.item.item &&
    a.item.depth === b.item.depth &&
    a.item.branch === b.item.branch &&
    a.item.revit?.join(",") === b.item.revit?.join(",") &&
    a.item.damage === b.item.damage &&
    a.row === b.row &&
    a.detail === b.detail &&
    a.cursor === b.cursor &&
    a.selected === b.selected &&
    a.expanded === b.expanded &&
    a.filtering === b.filtering &&
    a.tree === b.tree &&
    a.stage === b.stage &&
    a.refusal === b.refusal,
) as typeof ListItemViewInner;

function VirtualSectionBody<T, Sort extends string>(props: SectionBodyProps<T, Sort>) {
  const { list, live, rows, row, projection, scroller, headroom, detail, request, served, landed } =
    props;
  const body = useRef<HTMLDivElement>(null);
  // Null until measured: a request made as this body mounts waits for its real margin.
  const [margin, setMargin] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element || !scroller) return;
    const measure = () => {
      setMargin(
        element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          scroller.clientTop +
          scroller.scrollTop,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    scroller
      .querySelectorAll("[data-list-body], [data-list-bar], [data-list-section-head]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [scroller, list.sections.length, list.state.closed, rows.length]);
  const estimate = useRowHeight();
  const previous = useRef<ReturnType<typeof useVirtualizer<HTMLElement, Element>> | null>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate,
    getItemKey: (index) => rows[index]!.key,
    overscan: overscanRows(previous.current, scroller, rows.length, estimate),
    scrollMargin: margin ?? 0,
    scrollPaddingStart: headroom,
  });
  previous.current = virtual;
  const entries = virtual.getVirtualItems();
  const version = useMarkVersion(props);
  useProjection(
    () =>
      virtualSpans(virtual, rows.length, margin ?? 0, estimate, (index) =>
        markOf(list, rows[index]!, projection),
      ),
    version,
  );
  useLayoutEffect(() => landRequest(list, landed));
  const requestedKey = list.collection.cursor;
  const cursorIndex = rows.findIndex((item) => item.key === requestedKey);
  useLayoutEffect(() => {
    if (cursorIndex < 0 || !scroller || margin === null || served.current === request) return;
    served.current = request;
    virtual.scrollToIndex(cursorIndex, { align: "auto" });
  }, [request, cursorIndex, margin === null, scroller]);
  return (
    <div
      ref={body}
      data-list-body=""
      role="presentation"
      className="relative w-full shrink-0"
      style={{ height: virtual.getTotalSize() }}
    >
      {entries.map((entry) => {
        const item = rows[entry.index]!;
        return (
          <div
            key={entry.key}
            ref={virtual.measureElement}
            data-index={entry.index}
            role="presentation"
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${entry.start - (margin ?? 0)}px)` }}
          >
            <ListItemView
              {...rowState(list, item)}
              live={live}
              item={item}
              row={row}
              detail={detail}
            />
          </div>
        );
      })}
    </div>
  );
}

function landRequest<T, Sort extends string>(
  list: ListController<T, Sort>,
  landed: RefObject<number>,
) {
  const request = list.revealRequest;
  if (!request || landed.current === request.serial) return;
  const el = document.getElementById(list.collection.rowProps(request.key).id);
  if (!el) return;
  landed.current = request.serial;
  land(el);
}
