import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { ChevronRight } from "lucide-react";

import { Button } from "./button";
import { NarrowChip } from "./chip";
import { hasListFacet, type ListController, type ListItem } from "./collection";
import { EmptyState } from "./empty";
import { useScopeKeys } from "../../keys";
import { SearchControl } from "./search-control";
import { ListPopup } from "./list-popup";
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
}: {
  list: ListController<T, Sort>;
  label: string;
  primary?: boolean;
}) {
  const defaultOrder = list.grouped ? "Shelf order" : "Input order";
  const sortItems = [
    { key: "", label: defaultOrder },
    ...list.sorts.map((key) => ({ key, label: key })),
  ];
  return (
    <div data-list-bar="" data-surface="artifact">
      <ListFilter
        value={list.state.query}
        onChange={list.setQuery}
        shown={list.shown}
        total={list.total}
        label={`Search ${label}`}
        placeholder="Words, field=value, sort:name"
        primary={primary}
      />
      <div className="flex flex-wrap items-center gap-1 px-(--item-pad-x) py-1">
        {list.facets.map((facet) => (
          <div
            key={facet.key}
            role="group"
            aria-label={facet.key}
            className="flex flex-wrap items-center gap-1"
          >
            <ListPopup
              anchor="trigger"
              aria-label={`Filter ${facet.key}`}
              trigger={<span>{facet.key}</span>}
              items={facet.values}
              keyOf={(item) => item.value}
              labelOf={(item) => item.label ?? item.value}
              filter="words"
              searchAbove={8}
              empty={`No ${facet.key} values`}
              onPick={(item) => list.toggleFacet(facet.key, item.value)}
              row={(item) => ({
                label: item.label ?? item.value,
                meta: item.count,
                active: hasListFacet(list.state.query, facet.key, item.value),
              })}
            />
            {facet.values
              .filter(({ value }) => hasListFacet(list.state.query, facet.key, value))
              .map(({ value, label: title, count }) => (
                <NarrowChip
                  key={value}
                  label={`${facet.key}: ${title ?? value}`}
                  count={count}
                  title={`Filter ${facet.key} by ${title ?? value}`}
                  onRemove={() => list.toggleFacet(facet.key, value)}
                />
              ))}
          </div>
        ))}
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
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
      {props.bar !== false ? <ListBar list={list} label={label} primary={props.primary} /> : null}
      {!list.total ? (
        <EmptyState story="scope" exit={empty.exit}>
          {empty.message}
        </EmptyState>
      ) : !list.shown ? (
        <div role="status">
          <EmptyState story="filter" exit="Clear the search to see all rows">
            No matching {label}
          </EmptyState>
          <Button label="Clear search" onClick={() => list.setQuery("")}>
            Clear search
          </Button>
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
          list={props.list}
          item={item}
          row={props.row}
          detail={props.detail}
        />
      ))}
    </div>
  );
}

function ListItemView<T, Sort extends string>({
  list,
  item,
  row,
  detail,
}: Pick<SectionBodyProps<T, Sort>, "list" | "row" | "detail"> & { item: ListItem<T> }) {
  const parts = row(item.item);
  const behavior = list.collection.rowProps(item.key);
  const expanded = list.state.open.includes(item.key);
  return (
    <>
      <Row
        {...parts}
        {...behavior}
        onMouseMove={() => {
          behavior.onMouseMove();
          parts.onMouseMove?.();
        }}
        role={list.tree ? "treeitem" : "option"}
        stage={list.stageOf?.(item.item) ?? parts.stage}
        refusal={list.refusalOf?.(item.item) ?? parts.refusal}
        depth={list.tree ? item.depth : undefined}
        expanded={item.branch ? expanded || list.filtering : detail ? expanded : undefined}
        onToggle={() => list.toggleOpen(item.key)}
        actions={
          detail ? (
            <>
              {parts.actions}
              <Button
                label={`${expanded ? "Close" : "Open"} details`}
                onClick={() => list.toggleOpen(item.key)}
              >
                {expanded ? "Close" : "Details"}
              </Button>
            </>
          ) : (
            parts.actions
          )
        }
      />
      {expanded && detail ? <div data-list-detail="">{detail(item.item)}</div> : null}
    </>
  );
}

function VirtualSectionBody<T, Sort extends string>({
  list,
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
            <ListItemView list={list} item={item} row={row} detail={detail} />
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
    all.find((t) => active && t.region()?.contains(active)) ??
    all.find((t) => t.region()?.matches(":hover")) ??
    all.find((t) => t.primary) ??
    null
  );
}

export function ListFilter({
  value,
  onChange,
  shown,
  total,
  label,
  placeholder,
  primary = false,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Rows the query leaves, and rows there are. */
  shown: number;
  total: number;
  /** The input's accessible name. */
  label: string;
  placeholder?: string;
  /** The list `/` falls back to when the pointer and focus are over none. */
  primary?: boolean;
  /** Enter in the filter. */
  onEnter?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const self = useRef<Target | null>(null);
  self.current ??= {
    input: () => input.current,
    region: () =>
      input.current?.closest<HTMLElement>("[data-list-view]") ?? scrollParent(input.current),
    primary,
  };
  self.current.primary = primary;
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
        says: "Focuses the filter of the list under the pointer, else the one with focus, else the systems list.",
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
  const narrowed = value.trim() !== "";
  return (
    <SearchControl face="bar" data-list-filter="">
      <input
        ref={input}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent outline-none"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onChange("");
            event.currentTarget.blur();
          } else if (event.key === "Enter") onEnter?.();
        }}
      />
      <span className="t-small text-ink-2 face-mono shrink-0 pr-1" data-list-filter-count="">
        {narrowed ? `${shown} of ${total}` : total}
      </span>
    </SearchControl>
  );
}
