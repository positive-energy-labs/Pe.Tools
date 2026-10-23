import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
  type RefObject,
} from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

import { Button } from "./button";
import { type ListController, type ListItem } from "./collection";
import { EmptyState } from "./empty";
import { useScopeGestures, useScopeKeys } from "../../keys";
import { ListPopup } from "./list-popup";
import { ListSearchBox } from "./list-search";
import { Row, type RowProps } from "./row";
import "./lang.css";

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
  > & { "data-dim"?: boolean; "data-tone"?: string };
}

/** One renderer, one common scroller, one measured virtual body per section. No paged tails. */
export function ListView<T, Sort extends string = string>(props: ListViewProps<T, Sort>) {
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
  useLayoutEffect(() => {
    if (list.total < 60 && list.collection.cursor) {
      document
        .getElementById(list.collection.rowProps(list.collection.cursor).id)
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }, [list.total, list.collection.cursor, list.revealRequest?.serial]);
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
      {props.bar !== false ? <ListBar list={list} label={label} primary={props.primary} /> : null}
      {props.columns ? (
        <div className="dl-row-colhead" role="presentation" data-tree-columns="">
          <span className="dl-row-colhead-label">{props.columns.label}</span>
          {props.columns.meta != null ? (
            <span className="dl-row-colhead-meta">{props.columns.meta}</span>
          ) : null}
        </div>
      ) : null}
      {!list.total ? (
        <EmptyState story="scope" exit={empty.exit}>
          {empty.message}
        </EmptyState>
      ) : !list.shown ? (
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
              live={live}
              rows={section.rows}
              row={row}
              scroller={scroller}
              estimate={estimate}
              overscan={overscan}
              detail={detail}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}

type SectionBodyProps<T, Sort extends string> = {
  list: ListController<T, Sort>;
  live: RefObject<ListController<T, Sort>>;
  rows: readonly ListItem<T>[];
  row: (item: T) => ListRowParts;
  scroller: HTMLElement | null;
  estimate: number;
  overscan: number;
  detail?: (item: T) => ReactNode;
};

function SectionBody<T, Sort extends string>(props: SectionBodyProps<T, Sort>) {
  if (props.list.total >= 60) return <VirtualSectionBody {...props} />;
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
  list,
  live,
  rows,
  row,
  scroller,
  estimate,
  overscan,
  detail,
}: SectionBodyProps<T, Sort>) {
  const body = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
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
    scrollMargin: margin,
    scrollPaddingStart: headroom,
    scrollPaddingEnd: headroom,
  });
  const requestedKey = list.collection.cursor;
  const cursorIndex = rows.findIndex((item) => item.key === requestedKey);
  useLayoutEffect(() => {
    if (cursorIndex >= 0 && scroller) virtual.scrollToIndex(cursorIndex, { align: "auto" });
  }, [cursorIndex, margin, scroller, list.revealRequest?.serial, virtual]);
  return (
    <div
      ref={body}
      data-list-body=""
      role="presentation"
      className="relative w-full shrink-0"
      style={{ height: virtual.getTotalSize() }}
    >
      {virtual.getVirtualItems().map((entry) => {
        const item = rows[entry.index]!;
        return (
          <div
            key={entry.key}
            ref={virtual.measureElement}
            data-index={entry.index}
            role="presentation"
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${entry.start - margin}px)` }}
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

interface Target {
  input: () => HTMLInputElement | null;
  /** The region the filter belongs to: the pointer is "over" the list when it is over this. */
  region: () => HTMLElement | null;
  primary: boolean;
}
const targets = new Set<Target>();

/** The nearest ancestor that scrolls vertically (the pane body a list lives in). */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return null;
}

/** The filter `/` goes to: the one with focus in its region, then the one under the pointer, then the primary. */
function pick(): Target | null {
  const all = [...targets].filter((t) => t.input());
  const active = document.activeElement;
  return (
    all.find((t) => active && (t.region()?.contains(active) || t.input() === active)) ??
    all.find(
      (t) =>
        t.region()?.matches(":hover") || t.input()?.closest("[data-list-bar]")?.matches(":hover"),
    ) ??
    all.find((t) => t.primary) ??
    null
  );
}

function useListSearchFocus(
  input: RefObject<HTMLInputElement | null>,
  region: HTMLElement | null | undefined,
  primary: boolean,
) {
  const self = useRef<Target | null>(null);
  self.current ??= {
    input: () => input.current,
    region: () => null,
    primary,
  };
  self.current.primary = primary;
  self.current.region = () =>
    region ??
    input.current?.closest<HTMLElement>("[data-list-view]") ??
    scrollParent(input.current);
  useEffect(() => {
    const target = self.current!;
    targets.add(target);
    return () => void targets.delete(target);
  }, []);
  // The key binds on the document body: the list under the pointer need not hold focus.
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  useScopeKeys(
    [
      {
        hotkey: "/",
        label: "Filter the list",
        says: "Focuses the filter of the focused list, else the list under the pointer, else the primary list.",
        callback: (event) => {
          if (pick() !== self.current) return;
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        },
        options: { conflictBehavior: "allow", preventDefault: false },
      },
    ],
    body,
  );
}
