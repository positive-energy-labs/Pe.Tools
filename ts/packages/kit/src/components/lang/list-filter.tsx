/**
 * The one list filter: a command line that narrows a list as you type, with its "N of M" count,
 * and the `/` key that reaches it. Matching is a plain function (`matches`) over what a row declares
 * searchable, so a list narrows by every field a person could mean, not only the title.
 *
 * `/` focuses the filter of the list under the pointer, else the one that holds focus, else the
 * `primary` one. It never fires from inside a text field (the hotkey library's input guard), and
 * Escape in the filter clears it and leaves.
 */
import { useEffect, useRef, useState } from "react";

import { useScopeKeys } from "../../keys";
import { SearchControl } from "./search-control";

/** What a row declares searchable: words, and the element ids it stands for. */
export interface Searchable {
  text: readonly (string | number | null | undefined)[];
  ids?: readonly number[];
}

/**
 * Every whitespace-separated word of the query must match: as a substring of some text field
 * (case-insensitive), or, for an all-digit word, as exactly one of the row's element ids.
 * An empty query matches everything.
 */
export function matches(query: string, row: Searchable): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = row.text.filter((t) => t != null).map((t) => String(t).toLowerCase());
  return words.every(
    (word) =>
      text.some((t) => t.includes(word)) || (/^\d+$/.test(word) && !!row.ids?.includes(Number(word))),
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
    region: () => scrollParent(input.current),
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
