import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { focusQuiet } from "../../lib/utils";

/** One travel window for hover surfaces and the subjects they light. */
export const HOVER_GRACE = 700;

type Point = { x: number; y: number };
const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
/** The hull of the departure point and the measured popup, independent of requested placement. */
function inCorridor(p: Point, from: Point, box: DOMRect) {
  const corners = [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ];
  return corners.some((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    if (cross(from, a, b) === 0) return false;
    const signs = [cross(from, a, p), cross(a, b, p), cross(b, from, p)];
    return !signs.some((n) => n < 0) || !signs.some((n) => n > 0);
  });
}

const focusables = (root: ParentNode) =>
  [
    ...root.querySelectorAll<HTMLElement | SVGElement>(
      'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]',
    ),
  ].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(el).display !== "none" &&
      getComputedStyle(el).visibility !== "hidden",
  );

/** Portaled hover content owns the path to its actual box and its local keyboard order. */
export function useHoverSurface(
  anchor: Element | null,
  ref?: Ref<HTMLDivElement>,
  contact?: (element: HTMLDivElement | null, over: boolean) => void,
  close?: () => void,
) {
  const [popup, attach] = useState<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => popup!, [popup]);
  useEffect(() => {
    if (!anchor || !popup) return;
    let from: Point | null = null;
    let until = 0;
    const leave = (event: Event) => {
      if (!(event instanceof MouseEvent)) return;
      from = { x: event.clientX, y: event.clientY };
      until = Date.now() + HOVER_GRACE;
    };
    const inside = ({ clientX: x, clientY: y }: MouseEvent) => {
      const { left, right, top, bottom } = popup.getBoundingClientRect();
      return x >= left && x < right && y >= top && y < bottom;
    };
    const protect = (event: MouseEvent) => {
      contact?.(popup, inside(event));
      if (event.target instanceof Node && popup.parentElement?.contains(event.target)) {
        contact?.(popup, true);
        from = null;
        return;
      }
      if (
        from &&
        Date.now() <= until &&
        inCorridor({ x: event.clientX, y: event.clientY }, from, popup.getBoundingClientRect())
      )
        event.stopImmediatePropagation();
    };
    // A sibling's warm tooltip otherwise replaces this one before its close grace expires.
    const events = ["mouseover", "mouseenter", "mousemove"] as const;
    const leavePopup = (event: MouseEvent) => contact?.(popup, inside(event));
    const keydown = (event: KeyboardEvent) => {
      const escape = event.key === "Escape";
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (!escape && (event.key !== "Tab" || event.currentTarget === popup)) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const active = popup.ownerDocument.activeElement;
      const entering = anchor.contains(active);
      if ((!entering && !popup.contains(active)) || (!escape && entering && event.shiftKey)) return;
      const items = focusables(popup);
      if (!escape && !items.length) return;
      const index = items.findIndex((el) => el === active) + (event.shiftKey ? -1 : 1);
      const page = focusables(popup.ownerDocument).filter(
        (el) => !el.closest('[data-slot="tooltip-content"]'),
      );
      const next =
        (escape || index < 0 ? anchor : items.at(index)) ??
        page.at(page.findIndex((el) => el === anchor) + 1);
      if (!(next instanceof HTMLElement || next instanceof SVGElement)) return;
      event.preventDefault();
      event.stopPropagation();
      focusQuiet(next);
      if (escape || (next !== anchor && !popup.contains(next))) close?.();
    };
    popup.addEventListener("mouseleave", leavePopup);
    popup.addEventListener("keydown", keydown, true);
    anchor.addEventListener("mouseleave", leave);
    events.forEach((name) => popup.ownerDocument.addEventListener(name, protect, true));
    popup.ownerDocument.addEventListener("keydown", keydown);
    return () => {
      contact?.(null, false);
      popup.removeEventListener("mouseleave", leavePopup);
      popup.removeEventListener("keydown", keydown, true);
      anchor.removeEventListener("mouseleave", leave);
      events.forEach((name) => popup.ownerDocument.removeEventListener(name, protect, true));
      popup.ownerDocument.removeEventListener("keydown", keydown);
    };
  }, [anchor, popup, contact, close]);
  return attach;
}

export function useHoverGrace<T>(close: (value: T) => void) {
  const grace = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: { value: T } | undefined;
    const cancel = () => {
      clearTimeout(timer);
      pending = undefined;
    };
    const leave = (value: T) => {
      cancel();
      pending = { value };
      timer = setTimeout(() => {
        pending = undefined;
        close(value);
      }, HOVER_GRACE);
    };
    return {
      cancel,
      leave,
      hold: () => {
        if (pending) leave(pending.value);
      },
    };
  }, [close]);
  useEffect(() => grace.cancel, [grace]);
  return grace;
}
