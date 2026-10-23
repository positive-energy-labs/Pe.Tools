import type { Tone } from "../../lib/token";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useEffect,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type HTMLAttributes,
  type RefObject,
} from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

import { Minimap, MINIMAP_FROM, type MinimapRange, type MinimapMark } from "./gutter-minimap";
import { Button } from "./button";
import { VIRTUAL_FROM, type ListController, type ListItem } from "./collection";
import { EmptyState } from "./empty";
import { useScopeGestures, useScopeKeys, useScopeLive } from "../../keys";
import { OutcomeLine } from "./outcome";
import { ListPopup, StatusLine } from "./list-popup";
import { ListSearchBox } from "./list-search";
import { land, Row, type RowProps } from "./row";
import "./lang.css";
import { focusQuiet } from "../../lib/utils";

export type ListRowParts = Omit<
  Extract<RowProps, { as?: "div" }>,
  "id" | "role" | "cursor" | "selected" | "onClick" | "depth" | "expanded" | "onToggle"
>;

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

/** Search, facets and sort are views of the same query and state, with no private predicates. */
export function ListBar<T, Sort extends string>({
  list,
  label,
  primary = false,
  compact = false,
}: {
  list: ListController<T, Sort>;
  label: string;
  primary?: boolean;
  /** Keep narrow-pane controls on one horizontally scrollable line. */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  useListSearchFocus(input, list.target, primary);
  const defaultOrder = list.grouped ? "Shelf order" : "Input order";
  const sortItems = [
    { key: "", label: defaultOrder },
    ...list.sorts.map((key) => ({ key, label: key })),
  ];
  return (
    <div data-list-bar="" data-surface="artifact">
      <ListSearchBox list={list} label={label} input={input} />
      {list.collection.reading === "pending" && list.total ? (
        <OutcomeLine kind="busy" label="reading…" />
      ) : null}
      <div
        className={`flex items-center gap-1 ${compact ? "overflow-x-auto *:shrink-0" : "flex-wrap px-(--item-pad-x)"}`}
      >
        {list.sorts.length ? (
          <ListPopup
            aria-label={`Sort ${label}`}
            anchor="trigger"
            trigger={<span>Sort: {list.sort || defaultOrder}</span>}
            items={sortItems}
            keyOf={(item) => item.key}
            labelOf={(item) => item.label}
            select="single"
            selected={[list.sort]}
            empty="No sorts"
            onPick={(item) => list.setSort(item.key as Sort | "")}
            row={(item) => ({ label: item.label })}
          />
        ) : null}
      </div>
    </div>
  );
}

export interface ListViewProps<T, Sort extends string = string> {
  list: ListController<T, Sort>;
  row: (item: T) => ListRowParts;
  "aria-label": string;
  empty: { message: string; exit: string };
  /** Omit when the surrounding pane already owns scrolling. */
  maxHeight?: string;
  estimate?: number;
  overscan?: number;
  primary?: boolean;
  bar?: boolean;
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

/** One renderer, one common scroller, one measured virtual body per section. No paged tails. */
export function ListView<T, Sort extends string = string>(props: ListViewProps<T, Sort>) {
  return <ListRenderer {...props} />;
}

/** Small collections share rows, keys and sections without search chrome or virtualization. */
export function PlainList<T, Sort extends string = string>(
  props: Omit<ListViewProps<T, Sort>, "bar" | "primary" | "estimate" | "overscan">,
) {
  return <ListRenderer {...props} bar={false} plain />;
}

function ListRenderer<T, Sort extends string>(props: ListViewProps<T, Sort> & { plain?: boolean }) {
  useScopeGestures([
    { pointer: "click", label: "select the row" },
    { pointer: "hover", label: "move the cursor" },
  ]);
  const { list, row, empty, maxHeight, estimate = 40, overscan = 6, detail } = props;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    list.setTarget(root);
    setScroller(maxHeight ? root : (scrollParent(root) ?? root));
    return () => list.setTarget(null);
  }, [root, maxHeight, list.setTarget]);
  // N1: the view follows the cursor only when the person asked: a key moved it (`steer`) or a
  // reveal named it. A refresh, resize, hover or a linked pane's cursor never scrolls the list.
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
        const damage = row(item.item).damage;
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
      data-list-view=""
      data-columns={props.columns ? "" : undefined}
      className={`relative min-h-0 min-w-0 w-full${maxHeight ? "" : " shrink-0"}`}
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
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
      {props.bar !== false ? <ListBar list={list} label={label} primary={props.primary} /> : null}
      {props.columns ? (
        <div className="dl-row-colhead" role="presentation" data-tree-columns="">
          <span className="dl-row-colhead-label">{props.columns.label}</span>
          {props.columns.meta != null ? (
            <span className="dl-row-colhead-meta">{props.columns.meta}</span>
          ) : null}
        </div>
      ) : null}
      {props.bar === false && list.collection.reading === "pending" && list.total ? (
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
                top: `calc(var(--item-h) * ${index})`,
                bottom: `calc(var(--item-h) * ${list.sections.length - index - 1})`,
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
              estimate={estimate}
              overscan={overscan}
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
  estimate: number;
  overscan: number;
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

/** What a row draws from the list besides its item, as values a memoized row can compare. */
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
              {/* A glyph square like the row's other verbs: a worded verb was clipped to "D…". */}
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

/** A row renders again only when its item, its state or the caller's `row`/`detail` changes. A
 *  caller whose `row` is an inline arrow re-renders every row as before; a `useCallback` row lets a
 *  selection or cursor move redraw only the rows it touched. */
const ListItemView = memo(
  ListItemViewInner,
  (a, b) =>
    a.item.key === b.item.key &&
    a.item.item === b.item.item &&
    a.item.depth === b.item.depth &&
    a.item.branch === b.item.branch &&
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
  estimate,
  overscan,
  detail,
  request,
  served,
  landed,
}: SectionBodyProps<T, Sort>) {
  const body = useRef<HTMLDivElement>(null);
  // Null until measured: a request made as this body mounts waits for its real margin.
  const [margin, setMargin] = useState<number | null>(null);
  const [headroom, setHeadroom] = useState(0);
  useLayoutEffect(() => {
    if (!body.current || !scroller) return;
    const measure = () => {
      if (body.current) {
        setMargin(
          body.current.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            scroller.clientTop +
            scroller.scrollTop,
        );
        const heads = body.current
          .closest("[data-list-view]")
          ?.querySelectorAll<HTMLElement>("[data-list-section-head]");
        setHeadroom(
          Array.from(heads ?? []).reduce((height, head) => height + head.offsetHeight, 0),
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    scroller
      .querySelectorAll("[data-list-body], [data-list-bar], [data-list-section-head]")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [scroller, list.sections.length, list.state.closed, rows.length]);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate,
    getItemKey: (index) => rows[index]!.key,
    overscan,
    scrollMargin: margin ?? 0,
    scrollPaddingStart: headroom,
    scrollPaddingEnd: headroom,
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

export interface SearchKeyOwner {
  region: () => HTMLElement | null;
  focus: () => void;
  available?: () => boolean;
  primary?: boolean;
}
const targets = new Set<SearchKeyOwner>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const leader = () => targets.values().next().value ?? null;
const noLeader = () => null;

/** The nearest ancestor that scrolls vertically (the pane body a list lives in). */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return null;
}

/** The filter `/` goes to: the one with focus in its region, then the one under the pointer, then the primary. */
function pick(): SearchKeyOwner | null {
  const all = [...targets].filter((t) => t.available?.() !== false);
  const active = document.activeElement;
  return (
    all.find((t) => active && t.region()?.contains(active)) ??
    all.find((t) => t.region()?.matches(":hover")) ??
    all.find((t) => t.primary) ??
    null
  );
}

/** Register search intent; the first mounted registration owns the sole body binding. */
export function useSearchKey(owner: SearchKeyOwner) {
  const live = useScopeLive();
  const latest = useRef(owner);
  latest.current = owner;
  const [self] = useState<SearchKeyOwner>(() => ({
    region: () => latest.current.region(),
    focus: () => latest.current.focus(),
    available: () => latest.current.available?.() !== false,
    get primary() {
      return latest.current.primary;
    },
  }));
  useEffect(() => {
    if (!live) return;
    targets.add(self);
    listeners.forEach((notify) => notify());
    return () => {
      targets.delete(self);
      listeners.forEach((notify) => notify());
    };
  }, [self, live]);
  const bindingOwner = useSyncExternalStore(subscribe, leader, noLeader);
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  useScopeKeys(
    bindingOwner === self
      ? [
          {
            hotkey: "/",
            label: "Search",
            says: "Search the focused region, then the region under the pointer, then the primary list.",
            callback: (event) => {
              // The composer owns slash commands while its text field has focus.
              if (
                (document.activeElement as HTMLElement | null)?.closest(
                  "input, textarea, select, [contenteditable=true]",
                )
              )
                return;
              const target = pick();
              if (!target) return;
              event.preventDefault();
              target.focus();
            },
            options: { preventDefault: false },
          },
        ]
      : [],
    body,
  );
}

function useListSearchFocus(
  input: RefObject<HTMLInputElement | null>,
  region: HTMLElement | null | undefined,
  primary: boolean,
) {
  useSearchKey({
    region: () =>
      region ??
      input.current?.closest<HTMLElement>("[data-list-view]") ??
      scrollParent(input.current),
    available: () => !!input.current,
    primary,
    focus: () => {
      focusQuiet(input.current);
      input.current?.select();
    },
  });
}
