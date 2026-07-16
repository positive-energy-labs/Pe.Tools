import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";

/**
 * PickList — the workbench's "choose one from many" rail body. A filter field over a
 * grouped, keyboard-navigable list: type to narrow, ↑/↓ to move, Enter to pick (the top
 * match when you haven't moved), Escape to clear. Groups render in insertion order as
 * section-label headers. Pair it with SidePane, which owns collapse/expand and width —
 * PickList never draws its own chrome.
 */
export interface PickListItem {
  id: string;
  label: string;
  /** Section header this item sorts under; omitted items group under the empty header. */
  group?: string;
  /** Right-aligned measured fact (rendered in `tele`), e.g. a row count. */
  meta?: ReactNode;
  /** Native tooltip. */
  hint?: string;
}

export interface PickListProps {
  items: PickListItem[];
  /** The currently open item — marked, not the same thing as the keyboard cursor. */
  activeId?: string | null;
  onPick: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Shown when `items` itself is empty (distinct from "filter matched nothing"). */
  emptyNote?: ReactNode;
  className?: string;
}

export function PickList({
  items,
  activeId,
  onPick,
  placeholder = "Filter…",
  disabled = false,
  emptyNote,
  className,
}: PickListProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { groups, flat } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items;
    const map = new Map<string, PickListItem[]>();
    for (const item of filtered) {
      const key = item.group ?? "";
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    // Flat order = render order (groups in insertion order), so the cursor walks the screen.
    return { groups: map, flat: [...map.values()].flat() };
  }, [items, query]);

  const clampedCursor = Math.min(cursor, Math.max(0, flat.length - 1));

  const moveCursor = (next: number) => {
    setCursor(next);
    listRef.current
      ?.querySelector(`[data-pick-index="${next}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor((clampedCursor + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor((clampedCursor - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = flat[clampedCursor];
      if (item && !disabled) onPick(item.id);
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      setCursor(0);
    }
  };

  let index = -1;
  return (
    <div className={cn("flex min-h-0 flex-col", className)} onKeyDown={onKeyDown}>
      <div className="shrink-0 border-b border-border p-2">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">{emptyNote}</div>
        ) : flat.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Nothing matches “{query.trim()}”.
          </div>
        ) : (
          [...groups.entries()].map(([group, groupItems]) => (
            <div key={group} className="mb-1">
              {group && <p className="section-label px-3 pb-0.5 pt-2">{group}</p>}
              {groupItems.map((item) => {
                index += 1;
                const itemIndex = index;
                const active = item.id === activeId;
                const cursored = itemIndex === clampedCursor;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-pick-index={itemIndex}
                    disabled={disabled}
                    title={item.hint}
                    onClick={() => onPick(item.id)}
                    onMouseEnter={() => setCursor(itemIndex)}
                    className={cn(
                      "flex w-full items-baseline gap-2 border-l-2 px-3 py-1 text-left text-xs",
                      active
                        ? "border-primary bg-primary/8 font-medium text-primary"
                        : "border-transparent text-foreground",
                      cursored && !active && "bg-muted",
                      disabled && "opacity-50",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.meta != null && (
                      <span className="tele shrink-0 text-[10px] text-muted-foreground">
                        {item.meta}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
