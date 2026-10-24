import type { Tone } from "../../lib/token";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
  type RefObject,
} from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

import { Minimap, MINIMAP_FROM, type MinimapRange, type MinimapMark } from "./gutter-minimap";
import { Button } from "./button";
import { VIRTUAL_FROM, type ListController, type ListItem } from "./collection";
import { EmptyState } from "./empty";
import { ScopeGestures } from "../../keys";
import { OutcomeLine } from "./outcome";
import { StatusLine } from "./list-popup";
import { ListBar, scrollParent } from "./list-search";
export { useSearchKey, scrollParent, type SearchKeyOwner } from "./list-search";
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
  if (stuck && scroller)
    requestAnimationFrame(() =>
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          home.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          scroller.clientTop -
          (parseFloat(getComputedStyle(head).top) || 0),
        behavior: "smooth",
      }),
    );
}

export interface ListViewProps<T, Sort extends string = string> {
  list: ListController<T, Sort>;
  row: (item: T) => ListRowParts;
  "aria-label": string;
  empty: { message: string; exit: string };
  /** Omit when the surrounding pane already owns scrolling. */
  maxHeight?: string;
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
  return <ListRenderer {...props} />;
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
  const scroller = maxHeight ? root : (scrollParent(root) ?? root);
  useLayoutEffect(() => {
    list.setTarget(root);
    return () => list.setTarget(null);
  }, [root, list.setTarget]);
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
  const overview = useMemo(() => {
    const rows: ListItem<T>[] = [];
    const marks: MinimapMark[] = [];
    const offsets = new Map<string, number>();
    for (const section of list.sections) {
      offsets.set(section.key, rows.length);
      if (section.label) marks.push({ index: rows.length, head: true });
      if (!section.closed) rows.push(...section.rows);
    }
    if (rows.length >= MINIMAP_FROM)
      rows.forEach((item, index) => {
        const damage = row(item.item).damage ?? item.damage;
        if (damage || item.branch)
          marks.push({ index, damage: damage ?? undefined, head: item.branch });
      });
    return { rows, marks, offsets };
  }, [list.sections, row]);
  const [ranges, setRanges] = useState<Record<string, MinimapRange | null>>({});
  const [mapHeight, setMapHeight] = useState(0);
  const reportRange = useCallback((key: string, range: MinimapRange | null, height: number) => {
    setMapHeight(height);
    setRanges((old) =>
      old[key]?.start === range?.start && old[key]?.end === range?.end
        ? old
        : { ...old, [key]: range },
    );
  }, []);
  const inView = list.sections.flatMap((section) => {
    const range = ranges[section.key];
    const offset = overview.offsets.get(section.key) ?? 0;
    return range && !section.closed
      ? [{ start: range.start + offset, end: range.end + offset }]
      : [];
  });
  const mapRange = inView.length
    ? {
        start: Math.min(...inView.map((range) => range.start)),
        end: Math.max(...inView.map((range) => range.end)),
      }
    : null;
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
      onFocus={(event) => {
        // Keyboard focus lands on a row: the cursor row wears the ring (base.css), never the whole container.
        // No scroll follows (the move is not steered), and pointer focus keeps a list's cursorless start.
        if (event.target !== event.currentTarget || list.collection.cursor) return;
        if (!event.currentTarget.matches(":focus-visible")) return;
        const first = list.collection.visible.find((row) => row.kind !== "head");
        if (first) list.collection.setCursor(first.key);
      }}
      data-list-view=""
      className={`relative min-h-0 min-w-0 w-full${maxHeight ? "" : " shrink-0"}`}
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
      <ScopeGestures
        gestures={[
          { pointer: "click", label: "select the row" },
          { pointer: "hover", label: "move the cursor" },
        ]}
      />
      {!props.plain && (
        <Minimap
          count={overview.rows.length}
          range={mapRange}
          scroller={scroller}
          height={mapHeight}
          marks={overview.marks}
          onJump={(index) => {
            const item = overview.rows[index];
            if (item) list.reveal(item.key);
          }}
        />
      )}
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
              reportRange={overview.rows.length >= MINIMAP_FROM ? reportRange : undefined}
              row={row}
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
  reportRange?: (key: string, range: MinimapRange | null, height: number) => void;
  list: ListController<T, Sort>;
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

function SectionBody<T, Sort extends string>(props: SectionBodyProps<T, Sort>) {
  if (!props.plain && props.list.total >= VIRTUAL_FROM) return <VirtualSectionBody {...props} />;
  return (
    <div data-list-body="" role="presentation">
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

function VirtualSectionBody<T, Sort extends string>({
  sectionKey,
  reportRange,
  list,
  live,
  rows,
  row,
  scroller,
  headroom,
  detail,
  request,
  served,
  landed,
}: SectionBodyProps<T, Sort>) {
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
  const estimate = scroller
    ? parseFloat(getComputedStyle(scroller).getPropertyValue("--item-h")) || 20
    : 20;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate,
    getItemKey: (index) => rows[index]!.key,
    overscan: 6,
    scrollMargin: margin ?? 0,
    scrollPaddingStart: headroom,
  });
  const entries = virtual.getVirtualItems();
  const range = virtual.range;
  const offset = virtual.scrollOffset ?? 0;
  const height = virtual.scrollRect?.height ?? 0;
  const visible =
    margin !== null && offset + height > margin && offset < margin + virtual.getTotalSize();
  useLayoutEffect(() => {
    reportRange?.(
      sectionKey,
      visible && range ? { start: range.startIndex, end: range.endIndex } : null,
      height,
    );
  }, [sectionKey, reportRange, visible, range?.startIndex, range?.endIndex, height]);
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
