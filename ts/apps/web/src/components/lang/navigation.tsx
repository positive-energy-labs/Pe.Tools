/**
 * The thread roster: search, filters, shelves (`NavigationGroup`), rows (`NavigationItem`), a paged
 * tail. Rows are `Row`s; the view is a sentence-case, square, edge-to-edge list. Painted in navigation.css.
 */
import { useRef, useState, type ReactNode, type KeyboardEvent, type RefObject } from "react";
import {
  AlarmClock,
  ChevronRight,
  Clock3,
  Hand,
  LoaderCircle,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { Row } from "./row";
import { Input } from "./input";
import { Button } from "./button";
import { ListPopup } from "./list-popup";
import { KeyScope, useScopeKeys } from "#/route/keys";
import "./lang.css";
import "./navigation.css";

export function NavigationSearch({
  value,
  onChange,
  actions,
}: {
  value: string;
  onChange: (value: string) => void;
  actions?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  return (
    <KeyScope id="navigation-search" element={input}>
      <NavigationSearchKeys input={input} composing={composing} clear={() => onChange("")} />
      <div data-navigation-search="" className="dl-control">
        <Search aria-hidden />
        <Input
          ref={input}
          surface="embedded"
          aria-label="Search threads"
          placeholder="Search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
        {actions}
      </div>
    </KeyScope>
  );
}

function NavigationSearchKeys({
  input,
  composing,
  clear,
}: {
  input: RefObject<HTMLInputElement | null>;
  composing: RefObject<boolean>;
  clear: () => void;
}) {
  useScopeKeys([
    {
      hotkey: "Escape",
      callback: () => {
        if (!composing.current) clear();
      },
      label: "clear search",
      options: { ignoreInputs: false },
    },
    {
      hotkey: "ArrowDown",
      callback: () => {
        if (!composing.current)
          input.current
            ?.closest("nav")
            ?.querySelector<HTMLElement>('[data-key][role="button"]')
            ?.focus();
      },
      label: "first thread",
      options: { ignoreInputs: false },
    },
  ]);
  return null;
}

/** A shelf's open state outlives the page: stored per `persist` key, like a pane's width. */
function useShelfOpen(persist: string | undefined, initial: boolean) {
  const key = persist ? `pe.shelf.${persist}` : undefined;
  const [open, setOpen] = useState(() => {
    if (!key || typeof window === "undefined") return initial;
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "open";
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setOpen(next);
    if (!key) return;
    try {
      window.localStorage.setItem(key, next ? "open" : "closed");
    } catch {
      // The shelf still toggles for this page when storage is unavailable.
    }
  };
  return [open, set] as const;
}

/** The nearest ancestor that scrolls vertically: the list a stuck head scrolls within. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let at = element.parentElement; at; at = at.parentElement)
    if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at;
  return null;
}

/**
 * A SHELF of the roster: label, count, a hairline to a chevron. `compact` starts closed; `persist`
 * keeps the open choice. `stack` (this shelf's index of the shelves drawn) makes every head sticky
 * on the edge its shelf left by: the top while scrolled past, the bottom while below the fold.
 * Pressing a stuck head opens its shelf and scrolls it home; pressing a head at home toggles.
 */
export function NavigationGroup({
  label,
  count,
  children,
  compact = false,
  forceOpen = false,
  dim = false,
  persist,
  stack,
  onDrop,
}: {
  label: string;
  count: number;
  children: ReactNode;
  compact?: boolean;
  /** The shelf holds what must stay in view (the open thread, a search's hits); a press still shuts it. */
  forceOpen?: boolean;
  /** The shelf holds finished work (settled, archived): its rows read a step quieter. */
  dim?: boolean;
  persist?: string;
  stack?: { index: number; of: number };
  onDrop?: (id: string) => void;
}) {
  const [open, setOpen] = useShelfOpen(persist, !compact);
  // A press that shut a forced shelf holds until the force lifts.
  const [shut, setShut] = useState(false);
  if (shut && !forceOpen) setShut(false);
  const shown = open || (forceOpen && !shut);
  const home = useRef<HTMLSpanElement>(null);
  const press = (head: HTMLButtonElement) => {
    const stuck =
      Math.abs(head.getBoundingClientRect().top - home.current!.getBoundingClientRect().top) > 1;
    if (!stuck || !shown) {
      setOpen(!shown);
      setShut(forceOpen && shown);
    }
    if (!stuck) return;
    const scroller = scrollerOf(head);
    if (!scroller) return;
    // After the opened rows draw: the head's home goes where its sticky top holds it.
    requestAnimationFrame(() =>
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          home.current!.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          parseFloat(getComputedStyle(head).top || "0"),
        behavior: "smooth",
      }),
    );
  };
  return (
    <section
      data-navigation-group=""
      data-navigation-label={label}
      data-compact={compact || undefined}
      data-dim={dim || undefined}
      data-stack={stack ? "" : undefined}
      onDragOver={(event) => {
        if (onDrop) event.preventDefault();
      }}
      onDrop={(event) => {
        if (onDrop) {
          event.preventDefault();
          onDrop(event.dataTransfer.getData("text/pe-thread"));
        }
      }}
    >
      <span ref={home} data-slot="shelf-home" aria-hidden />
      <button
        type="button"
        aria-expanded={shown}
        style={
          stack
            ? {
                top: `calc(var(--item-h) * ${stack.index})`,
                bottom: `calc(var(--item-h) * ${stack.of - 1 - stack.index})`,
              }
            : undefined
        }
        onClick={(event) => press(event.currentTarget)}
      >
        <span>{label}</span>
        <span data-slot="count">{count}</span>
        <span data-slot="rule" aria-hidden />
        <ChevronRight aria-hidden />
      </button>
      {shown ? children : null}
    </section>
  );
}

/** A head-style strip of roster filters under the search; it wraps rather than overflows. */
export function NavigationFilters({ children }: { children: ReactNode }) {
  return (
    <div data-navigation-filters="" role="group" aria-label="Filter threads">
      {children}
    </div>
  );
}

/** One roster filter: its word until a value is picked, then the value and a clear. "*" is all. */
export function NavigationFilter<K extends string>({
  label,
  all,
  options,
  value,
  onChange,
}: {
  label: string;
  /** The first option, meaning no filter ("All targets"). */
  all: string;
  options: { key: K; label: string }[];
  value: K | "*";
  onChange: (key: K | "*") => void;
}) {
  const picked = options.find((option) => option.key === value);
  return (
    <span data-navigation-filter="" data-active={picked ? "" : undefined}>
      <ListPopup<{ key: K | "*"; label: string }>
        anchor="trigger"
        trigger={picked?.label ?? label}
        title={picked ? `${label}: ${picked.label}` : undefined}
        triggerLabel={picked ? `${label}: ${picked.label}` : `Filter threads by ${label}`}
        aria-label={label}
        items={[{ key: "*", label: all }, ...options]}
        keyOf={(option) => option.key}
        labelOf={(option) => option.label}
        empty={`No ${label.toLowerCase()}`}
        onPick={(option) => onChange(option.key)}
        row={(option) => ({ label: option.label, active: option.key === value })}
      />
      {picked ? (
        <Button
          icon={X}
          label={`Clear the ${label.toLowerCase()} filter`}
          onClick={() => onChange("*")}
        />
      ) : null}
    </span>
  );
}

/** An on/off roster filter (Unread): a framed toggle that composes with the picked filters; its
 *  count is how many rows it would leave. */
export function NavigationToggle({
  label,
  count,
  pressed,
  onChange,
}: {
  label: string;
  count: number;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
}) {
  return (
    <Button kind="framed" label={label} pressed={pressed} onClick={() => onChange(!pressed)}>
      {label}
      <span data-slot="count">{count}</span>
    </Button>
  );
}

/** A shelf's paged tail: says how many rows are not drawn, and draws the next page. */
export function NavigationMore({
  hidden,
  step,
  onMore,
}: {
  hidden: number;
  step: number;
  onMore: () => void;
}) {
  return (
    <button type="button" data-navigation-more="" onClick={onMore}>
      Show {Math.min(step, hidden)} more
      <span data-slot="count">{hidden} hidden</span>
    </button>
  );
}

export function NavigationItem({
  id,
  title,
  target,
  mark,
  meta,
  time,
  state,
  stateTone,
  activity,
  unread,
  active,
  compact,
  actions,
  onPick,
  onRename,
  onMenu,
  selected,
  onSelect,
  onDrop,
}: {
  id: string;
  title: string;
  /** The thread's target, when bound. */
  target?: ReactNode;
  /** The harness's `ProviderMark`, at the bottom right. */
  mark?: ReactNode;
  /** Who answers: harness · model, retained on the provider mark and row's hover. */
  meta: ReactNode;
  time: ReactNode;
  /** Only an activity that asks for something (failed, waiting, working, snoozed until);
   * the resting state says nothing. */
  state?: ReactNode;
  stateTone?: "alarm" | "caution";
  activity?: "running" | "waiting" | "failed" | "snoozed" | "woke";
  unread?: boolean;
  active?: boolean;
  compact?: boolean;
  actions: ReactNode;
  onPick: () => void;
  onRename: () => void;
  onMenu: () => void;
  selected?: boolean;
  onSelect?: (range: boolean) => void;
  onDrop?: (id: string) => void;
}) {
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick();
    }
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      onMenu();
    }
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const items = [
        ...event.currentTarget
          .closest("[data-navigation]")!
          .querySelectorAll<HTMLElement>('[data-key][role="button"]'),
      ];
      const index = items.indexOf(event.currentTarget);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      event.preventDefault();
      items[next]?.focus();
    }
  };
  const StateIcon =
    activity === "running"
      ? LoaderCircle
      : activity === "waiting"
        ? Hand
        : activity === "failed"
          ? TriangleAlert
          : activity === "snoozed"
            ? Clock3
            : activity === "woke"
              ? AlarmClock
              : null;
  const stateWord =
    state == null ? null : (
      <span
        data-slot="nav-state"
        className="shrink-0"
        data-tone={stateTone}
        role={StateIcon ? "img" : undefined}
        aria-label={StateIcon ? (typeof state === "string" ? state : activity) : undefined}
        title={typeof state === "string" ? state : undefined}
      >
        {StateIcon ? (
          <StateIcon aria-hidden className={activity === "running" ? "animate-spin" : undefined} />
        ) : (
          state
        )}
        {StateIcon ? (
          <span>
            {activity === "waiting" ? "Waiting" : activity === "snoozed" ? "Snoozed" : state}
          </span>
        ) : null}
      </span>
    );
  return (
    <div
      data-navigation-item=""
      data-layout="title-target"
      data-unread={unread || undefined}
      data-compact={compact || undefined}
    >
      <Row
        role="button"
        tabIndex={0}
        data-key={id}
        lines={2}
        active={active}
        selected={selected}
        label={title}
        meta={
          <>
            {stateWord}
            <span data-slot="nav-time">{time}</span>
            {unread ? <span data-slot="nav-unread" role="img" aria-label="unread" /> : null}
          </>
        }
        sub={
          <span data-slot="nav-line">
            <span className="min-w-0 flex-1 truncate">{target}</span>
            <span data-slot="nav-provider" title={typeof meta === "string" ? meta : undefined}>
              {mark}
            </span>
          </span>
        }
        actions={actions}
        title={[
          title,
          typeof meta === "string" ? meta : null,
          typeof target === "string" ? target : null,
          typeof time === "string" ? time : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey) onSelect?.(event.shiftKey);
          else onPick();
        }}
        onKeyDown={keys}
        onDoubleClick={onRename}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu();
        }}
        draggable
        onDragStart={(event) => event.dataTransfer.setData("text/pe-thread", id)}
        onDragOver={(event) => {
          if (onDrop) event.preventDefault();
        }}
        onDrop={(event) => {
          if (onDrop) {
            event.preventDefault();
            event.stopPropagation();
            onDrop(event.dataTransfer.getData("text/pe-thread"));
          }
        }}
      />
    </div>
  );
}
