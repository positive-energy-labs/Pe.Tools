import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "#/lib/utils";
import { Button } from "#/components/ui/button";

/**
 * SidePane — one width-adjustable flanking pane for the workbench. Replaces the ad-hoc
 * sidebars (chat-shell `--side`, family-types `w-[40%]`, the plugin lane). Native-first:
 * plain divs + tokens, Radix-style `data-state`/`data-side`. Open state is controlled OR
 * uncontrolled; width persists to a caller-supplied localStorage key. When closed it does
 * NOT vanish — it collapses to an interactive rail with an expander (plus any caller icons).
 */
export interface SidePaneProps {
  /** Which content edge the pane flanks. Border + drag handle sit on the content-facing side. */
  side: "left" | "right";
  /** Controlled open state. Omit for uncontrolled (see `defaultOpen`). */
  open?: boolean;
  /** Initial open state when uncontrolled. Default: true. */
  defaultOpen?: boolean;
  /** Fired on every open/close (rail toggle or programmatic). */
  onOpenChange?: (open: boolean) => void;
  /** localStorage key for the persisted width. Also namespaces this pane. */
  storageKey: string;
  /** Clamp floor / initial width. Default min 240, width 300. Max also capped at 50vw. */
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  /** Fired on every drag tick with the new clamped width. */
  onWidthChange?: (px: number) => void;
  /**
   * Optional extra rail contents when collapsed — a vertical stack of caller icon buttons.
   * The product default is chevron-only: the collapsed rail renders ONLY the expand chevron
   * unless a caller opts into an icon stack here. Prefer leaving this unset.
   */
  rail?: ReactNode;
  /** Header slot, shown above the scrollable body when open. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}

const RAIL = 40;

export function SidePane({
  side,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  storageKey,
  minWidth = 240,
  maxWidth,
  defaultWidth = 300,
  onWidthChange,
  rail,
  header,
  children,
  className,
}: SidePaneProps) {
  // Controlled if `open` is passed; otherwise track internally.
  const [openUncontrolled, setOpenUncontrolled] = useState(defaultOpen);
  const open = openProp ?? openUncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenUncontrolled(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= minWidth ? saved : defaultWidth;
  });

  const paneRef = useRef<HTMLDivElement>(null);

  // Drag the content-facing edge. Left pane grows rightward, right pane grows leftward.
  // Clamp [minWidth, min(maxWidth, 50vw)], persist, and report each tick to the caller.
  const onResizeDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startW = paneRef.current?.offsetWidth ?? width;
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const max = Math.min(maxWidth ?? Infinity, window.innerWidth / 2);
      const move = (ev: PointerEvent) => {
        const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
        const next = Math.round(Math.max(minWidth, Math.min(max, startW + delta)));
        setWidth(next);
        localStorage.setItem(storageKey, String(next));
        onWidthChange?.(next);
      };
      const up = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    },
    [side, minWidth, maxWidth, storageKey, onWidthChange, width],
  );

  const border = side === "left" ? "border-r" : "border-l";
  // Chevron points "outward when open" (collapse) / "inward when closed" (expand).
  const Collapse = side === "left" ? ChevronLeft : ChevronRight;
  const Expand = side === "left" ? ChevronRight : ChevronLeft;

  if (!open) {
    // Product default: chevron-only rail. The `rail` slot is optional — the owner dislikes
    // icon-stack rails, so callers should normally leave it unset and get just the expander.
    return (
      <div
        data-state="collapsed"
        data-side={side}
        style={{ width: RAIL }}
        className={cn(
          "flex shrink-0 flex-col items-center gap-1 border-[var(--line)] bg-[var(--paper)] py-2",
          border,
          className,
        )}
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Expand pane"
          onClick={() => setOpen(true)}
        >
          <Expand />
        </Button>
        {rail && <div className="mt-1 flex flex-col items-center gap-1">{rail}</div>}
      </div>
    );
  }

  return (
    <div
      ref={paneRef}
      data-state="open"
      data-side={side}
      style={{ width }}
      className={cn(
        "relative flex shrink-0 flex-col border-[var(--line)] bg-[var(--paper)]",
        border,
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--line)] px-2.5">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Collapse pane"
          onClick={() => setOpen(false)}
        >
          <Collapse />
        </Button>
        <div className="min-w-0 flex-1">{header}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {/* Drag handle on the content-facing edge — a 5px hit target, hairline on hover. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize pane"
        onPointerDown={onResizeDown}
        className={cn(
          "absolute inset-y-0 z-10 w-[5px] cursor-col-resize touch-none",
          "hover:bg-[var(--line-2)] active:bg-[var(--line-2)]",
          side === "left" ? "-right-[2px]" : "-left-[2px]",
        )}
      />
    </div>
  );
}
