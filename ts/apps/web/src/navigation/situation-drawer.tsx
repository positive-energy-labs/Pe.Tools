import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import {
  RouteControlsSlot,
  useRouteSlotPresence,
  usePublishSituationPresentation,
  useSituationSignal,
  useSituationDock,
  usePagePaletteOpen,
} from "./route-controls";

export const ownsOpenPopup = (element: HTMLElement | null) =>
  Boolean(element?.querySelector('[data-popup-open], [aria-haspopup][aria-expanded="true"]'));

/** The route remains mounted; only presentation/focus admission changes when this drawer folds. */
export function SituationDrawer({
  barAnchor,
  rail,
}: {
  barAnchor?: HTMLElement | null;
  rail?: ReactNode;
}) {
  const enabled = useRouteSlotPresence("situation");
  const available = enabled || rail != null;
  const trigger = useRef<HTMLSpanElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { dockHost, pinned, setPinned } = useSituationDock();
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const [popup, setPopup] = useState(false);
  const pagePaletteOpen = usePagePaletteOpen();
  const pagePaletteOpenRef = useRef(pagePaletteOpen);
  pagePaletteOpenRef.current = pagePaletteOpen;
  const openRef = useRef(false);
  const pointerOwned = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  const [top, setTop] = useState(0);
  const signal = useSituationSignal();
  const previous = useRef(signal?.stamp);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (previous.current === signal?.stamp) return;
    previous.current = signal?.stamp;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(timer);
  }, [signal?.stamp]);
  const open =
    available && (pagePaletteOpen || (!dismissed && (hovered || focused || pinned || popup)));
  openRef.current = open;
  usePublishSituationPresentation(open);
  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    pointerOwned.current = true;
    setDismissed(false);
    setHovered(true);
  };
  useEffect(() => {
    setMounted(true);
    const host = document.createElement("div");
    host.className = "pe-situation-portal";
    document.body.append(host);
    setPortalHost(host);
    return () => {
      host.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useLayoutEffect(() => {
    if (portalHost) (pinned && dockHost ? dockHost : document.body).append(portalHost);
  }, [portalHost, pinned, dockHost]);
  useEffect(() => {
    if (!available) {
      setPinned(false);
      setHovered(false);
      setFocused(false);
      setPopup(false);
    }
  }, [available]);
  useEffect(() => {
    if (!mounted) return;
    const bar = barAnchor ?? trigger.current?.closest<HTMLElement>(".pe-appbar");
    if (!bar) return;
    const position = () => setTop(bar.getBoundingClientRect().bottom);
    const editable = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'));
    const over = (event: PointerEvent) => {
      if (openRef.current || !editable(event.target)) enter();
    };
    const owns = (target: EventTarget | null) =>
      target instanceof Node && (bar.contains(target) || Boolean(drawer.current?.contains(target)));
    const leave = (event: PointerEvent) => {
      if (owns(event.relatedTarget)) {
        enter();
        return;
      }
      pointerOwned.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pointerOwned.current || bar.matches(":hover") || drawer.current?.matches(":hover"))
          return;
        setHovered(false);
      }, 500);
    };
    const body = drawer.current;
    bar.addEventListener("pointerover", over);
    bar.addEventListener("pointerleave", leave);
    body?.addEventListener("pointerenter", enter);
    body?.addEventListener("pointerleave", leave);
    position();
    window.addEventListener("resize", position);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      bar.removeEventListener("pointerover", over);
      bar.removeEventListener("pointerleave", leave);
      body?.removeEventListener("pointerenter", enter);
      body?.removeEventListener("pointerleave", leave);
      window.removeEventListener("resize", position);
    };
  }, [mounted, barAnchor]);
  useEffect(() => {
    if (!mounted) return;
    const updatePopup = () => setPopup(openRef.current && ownsOpenPopup(drawer.current));
    const observer = new MutationObserver(updatePopup);
    if (drawer.current)
      observer.observe(drawer.current, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-expanded", "data-popup-open"],
      });
    const focus = (event: FocusEvent) => {
      const inside =
        event.target instanceof Node &&
        Boolean(drawer.current?.contains(event.target) || trigger.current?.contains(event.target));
      setFocused(inside);
      if (inside) setDismissed(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        pagePaletteOpenRef.current ||
        ownsOpenPopup(drawer.current)
      )
        return;
      setPinned(false);
      setHovered(false);
      setFocused(false);
      setDismissed(true);
    };
    document.addEventListener("focusin", focus);
    window.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", focus);
      window.removeEventListener("keydown", escape);
    };
  }, [mounted]);
  return (
    <>
      <span ref={trigger} className="pe-situation-trigger">
        <span data-situation-pulse={pulse || undefined}>
          <HotkeyCommand
            label="Show Situation"
            word="Situation"
            hotkey={{ key: ".", mod: true }}
            invoke={() => {
              setPinned((prior) => !prior);
              setDismissed(pinned);
            }}
            refusal={available ? undefined : "This page has no Situation"}
            data-situation-kind={signal?.kind}
            data-tone={signal?.tone}
            reason={signal?.title}
            aria-controls="pe-situation-drawer"
            aria-expanded={open}
            pressed={pinned}
          />
        </span>
      </span>
      {portalHost &&
        createPortal(
          <div
            ref={drawer}
            id="pe-situation-drawer"
            role="region"
            aria-label="Situation drawer"
            aria-hidden={!open}
            inert={!open}
            data-state={open ? "open" : "closed"}
            data-mode={pinned ? "pinned" : "floating"}
            data-surface="page"
            className="pe-situation-drawer hairline-b shadow-float z-sticky"
            style={pinned ? undefined : { top }}
          >
            {rail && (
              <div
                className="pe-situation-control-rail hairline-b"
                role="group"
                aria-label="Page controls"
              >
                {rail}
              </div>
            )}
            <RouteControlsSlot slot="situation" as="div" className="min-w-0" />
          </div>,
          portalHost,
        )}
    </>
  );
}
