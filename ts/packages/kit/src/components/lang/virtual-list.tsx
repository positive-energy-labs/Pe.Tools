/**
 * `<VirtualList>`: the one long list. It draws only the rows near the viewport (TanStack Virtual),
 * so a list of hundreds costs what a screenful does. The scroller is the list's nearest scrolling
 * ancestor (a `Pane scroll="auto"`), never a second one, so headers above the list scroll with it.
 *
 * Semantics stay a list: `role="list"` over the caller's `role="listitem"` Rows (each wrapped in a
 * presentational positioner). ↑ ↓ Home End move focus between rows, mounting the target first;
 * `scrollTo` keeps a selected row in view the way `scrollIntoView({ block: "nearest" })` does.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ListFilter, matches, scrollParent, type Searchable } from "./list-filter";

export interface VirtualListProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** One row: a Row with `role="listitem"` and `tabIndex={0}`. */
  row: (item: T, index: number) => ReactNode;
  "aria-label": string;
  /** The row height before it is measured, px: one item height, or two for `lines={2}`. */
  estimate?: number;
  /** Rows drawn beyond the viewport on each side. */
  overscan?: number;
  /** The index to keep in view (a selected row); null leaves the scroll alone. */
  scrollTo?: number | null;
  /**
   * Present, the list heads itself with a filter (`/` reaches it): rows narrow to those whose
   * `searchOf` matches every word typed. `onSole` is Enter when exactly one row is left.
   */
  filter?: {
    label: string;
    placeholder?: string;
    searchOf: (item: T) => Searchable;
    /** What the items are, for the empty state ("systems"). */
    noun: string;
    /** `/` falls back to this list when the pointer and focus are over none. */
    primary?: boolean;
    onSole?: (item: T) => void;
  };
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const { keyOf, row, estimate = 36, overscan = 8, scrollTo = null, filter } = props;
  const [query, setQuery] = useState("");
  const items = useMemo(
    () =>
      filter && query.trim()
        ? props.items.filter((item) => matches(query, filter.searchOf(item)))
        : props.items,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filter's searchOf is a pure reader of the item
    [props.items, query, filter?.searchOf],
  );
  const list = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  // Where the list begins inside the scroller: what sits above it (a search box, a legend).
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const parent = scrollParent(list.current);
    setScroller(parent);
    if (!parent || !list.current) return;
    const measure = () =>
      setMargin(
        list.current!.getBoundingClientRect().top -
          parent.getBoundingClientRect().top +
          parent.scrollTop,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    for (const sibling of parent.children) observer.observe(sibling);
    return () => observer.disconnect();
  }, []);

  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate,
    overscan,
    scrollMargin: margin,
    getItemKey: (index) => keyOf(items[index]!),
  });

  useLayoutEffect(() => {
    if (scrollTo != null && scrollTo >= 0) virtual.scrollToIndex(scrollTo, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when the target moves
  }, [scrollTo]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
      const at = Number(
        (event.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset.index ?? -1,
      );
      const last = items.length - 1;
      const next =
        event.key === "ArrowDown"
          ? Math.min(last, at + 1)
          : event.key === "ArrowUp"
            ? Math.max(0, at - 1)
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? last
                : null;
      if (next === null || at < 0) return;
      event.preventDefault();
      virtual.scrollToIndex(next, { align: "auto" });
      // The target may not be mounted yet: focus it once the virtualizer has drawn it.
      const focus = (tries: number) => {
        const target = list.current?.querySelector<HTMLElement>(`[data-index="${next}"] > *`);
        if (target) target.focus({ preventScroll: true });
        else if (tries > 0) requestAnimationFrame(() => focus(tries - 1));
      };
      requestAnimationFrame(() => focus(5));
    },
    [items.length, virtual],
  );

  const drawn = (
    <div
      ref={list}
      role="list"
      aria-label={props["aria-label"]}
      aria-rowcount={items.length}
      className="relative w-full shrink-0"
      style={{ height: virtual.getTotalSize() }}
      onKeyDown={onKeyDown}
    >
      {virtual.getVirtualItems().map((v) => (
        <div
          key={v.key}
          ref={virtual.measureElement}
          data-index={v.index}
          role="presentation"
          className="absolute top-0 left-0 w-full"
          style={{ transform: `translateY(${v.start - margin}px)` }}
        >
          {row(items[v.index]!, v.index)}
        </div>
      ))}
    </div>
  );
  if (!filter) return drawn;
  return (
    <>
      <div className="sticky top-0 z-10 shrink-0">
        <ListFilter
          value={query}
          onChange={setQuery}
          shown={items.length}
          total={props.items.length}
          label={filter.label}
          placeholder={filter.placeholder}
          primary={filter.primary}
          onEnter={() => {
            if (items.length === 1) filter.onSole?.(items[0]!);
          }}
        />
      </div>
      {items.length === 0 && props.items.length > 0 ? (
        <p className="t-small text-ink-2 px-2 py-2" role="status" data-list-filter-empty="">
          no {filter.noun} match &ldquo;{query.trim()}&rdquo; ({props.items.length} in all);{" "}
          <button type="button" className="underline" onClick={() => setQuery("")}>
            clear the filter
          </button>
        </p>
      ) : null}
      {drawn}
    </>
  );
}
