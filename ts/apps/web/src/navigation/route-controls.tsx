import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouterState } from "@tanstack/react-router";
import { HostedChrome } from "#/route/hosted-chrome";
import { routePath } from "./model";

export type RouteControlName = "controls" | "lamp" | "situation" | "palette" | "inspector" | "settings";
export type SituationSignal = {
  kind: "history" | "failure" | "busy" | "health" | "ready" | "unbound";
  tone: "nav" | "alarm" | "commit" | "caution" | "done";
  title: string;
  stamp: string;
};
type Slot = {
  elements: Partial<Record<RouteControlName, HTMLElement | null>>;
  owners: Partial<Record<RouteControlName, symbol | null>>;
  claim: (slot: RouteControlName, owner: symbol) => void;
  release: (slot: RouteControlName, owner: symbol) => void;
  setElement: (slot: RouteControlName, element: HTMLElement | null) => void;
  /** The primary route's page palette (Ctrl+K): its open state and its own setter. */
  pagePalette: PagePalette | null;
  setPagePalette: (palette: PagePalette) => void;
  clearPagePalette: (owner: symbol) => void;
  /** The shell's global palette (Ctrl+Shift+K). */
  globalOpen: boolean;
  setGlobalOpen: (open: boolean) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  dockHost: HTMLDivElement | null;
  setDockHost: (host: HTMLDivElement | null) => void;
  pinned: boolean;
  setPinned: (pinned: boolean | ((prior: boolean) => boolean)) => void;
  signal: (SituationSignal & { owner: symbol }) | null;
  setSignal: (signal: Slot["signal"]) => void;
  clearSignal: (owner: symbol) => void;
};
type PagePalette = { owner: symbol; open: boolean; set: (open: boolean) => void };
const Context = createContext<Slot | null>(null);
export function useHasGlobalNavigation() {
  return useContext(Context) != null;
}
export function RouteControlsProvider({ children }: { children: ReactNode }) {
  const [elements, setElements] = useState<Slot["elements"]>({});
  const [owners, setOwners] = useState<Slot["owners"]>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pagePalette, setPagePalette] = useState<PagePalette | null>(null);
  const clearPagePalette = useCallback(
    (owner: symbol) => setPagePalette((prior) => (prior?.owner === owner ? null : prior)),
    [],
  );
  const [globalOpen, setGlobalOpen] = useState(false);
  // One palette at a time: a page palette opening by its own key closes the global one.
  const pageOpen = pagePalette?.open ?? false;
  useEffect(() => {
    if (pageOpen) setGlobalOpen(false);
  }, [pageOpen]);
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(false);
  const [signal, setSignal] = useState<Slot["signal"]>(null);
  const clearSignal = useCallback(
    (owner: symbol) => setSignal((prior) => (prior?.owner === owner ? null : prior)),
    [],
  );
  const setElement = useCallback(
    (slot: RouteControlName, element: HTMLElement | null) =>
      setElements((prior) => (prior[slot] === element ? prior : { ...prior, [slot]: element })),
    [],
  );
  const claim = useCallback(
    (slot: RouteControlName, owner: symbol) =>
      setOwners((prior) => (prior[slot] === owner ? prior : { ...prior, [slot]: owner })),
    [],
  );
  const release = useCallback(
    (slot: RouteControlName, token: symbol) =>
      setOwners((prior) => (prior[slot] === token ? { ...prior, [slot]: null } : prior)),
    [],
  );
  return (
    <Context
      value={{
        elements,
        setElement,
        owners,
        claim,
        release,
        pagePalette,
        setPagePalette,
        clearPagePalette,
        globalOpen,
        setGlobalOpen,
        drawerOpen,
        setDrawerOpen,
        dockHost,
        setDockHost,
        pinned,
        setPinned,
        signal,
        setSignal,
        clearSignal,
      }}
    >
      {children}
    </Context>
  );
}
export function SituationPinnedControl() {
  const context = useContext(Context);
  return <div ref={context?.setDockHost} className="pe-situation-dock" />;
}
export function useSituationDock() {
  const context = useContext(Context);
  if (!context) throw new Error("SituationDrawer requires RouteControlsProvider");
  return { dockHost: context.dockHost, pinned: context.pinned, setPinned: context.setPinned };
}
export function usePagePaletteOpen() {
  return useContext(Context)?.pagePalette?.open ?? false;
}
/**
 * Publish the real picker: its lifecycle and its setter, so the shell can open it from the bar
 * and close it when the global palette opens. Hidden Activities release the primary route claim.
 */
export function usePublishPagePalette(route: string, open: boolean, set: (open: boolean) => void) {
  const context = useContext(Context);
  const primary = useIsPrimaryRoute(route);
  const owner = useRef(Symbol(route)).current;
  const setter = useRef(set);
  setter.current = set;
  const publish = context?.setPagePalette;
  const clear = context?.clearPagePalette;
  useEffect(() => {
    if (!primary || !publish || !clear) return;
    publish({ owner, open, set: (next) => setter.current(next) });
  }, [primary, open, publish, clear, owner]);
  useEffect(() => {
    if (!primary || !clear) return;
    return () => clear(owner);
  }, [primary, clear, owner]);
}
/** The shell's one palette state: at most one of the page palette and the global palette is open. */
export function usePalette() {
  const context = useContext(Context);
  if (!context) throw new Error("usePalette requires RouteControlsProvider");
  const { pagePalette, globalOpen, setGlobalOpen } = context;
  const open: "page" | "global" | null = pagePalette?.open ? "page" : globalOpen ? "global" : null;
  return {
    open,
    /** The current route publishes a page palette the bar may open. */
    hasPage: pagePalette != null,
    show(kind: "page" | "global") {
      if (kind === "global") pagePalette?.set(false);
      else pagePalette?.set(true);
      setGlobalOpen(kind === "global");
    },
    hide() {
      pagePalette?.set(false);
      setGlobalOpen(false);
    },
  };
}
export function useSituationSignal() {
  return useContext(Context)?.signal ?? null;
}
export function usePublishSituationSignal(route: string, value: SituationSignal) {
  const context = useContext(Context);
  const primary = useIsPrimaryRoute(route);
  const owner = useRef(Symbol(route)).current;
  const publish = context?.setSignal;
  const clear = context?.clearSignal;
  useEffect(() => {
    if (!primary || !publish || !clear) return;
    publish({ ...value, owner });
    return () => clear(owner);
  }, [primary, publish, clear, owner, value.kind, value.tone, value.title, value.stamp]);
}
export function useSituationPresentation(route: string) {
  const slot = useContext(Context);
  const primary = useIsPrimaryRoute(route);
  return !primary || !slot?.owners.situation || slot.drawerOpen;
}
export function usePublishSituationPresentation(open: boolean) {
  const setOpen = useContext(Context)?.setDrawerOpen;
  useEffect(() => {
    setOpen?.(open);
    return () => setOpen?.(false);
  }, [open, setOpen]);
}
export function useRouteControlPresence(slot: RouteControlName) {
  return Boolean(useContext(Context)?.owners[slot]);
}
export function useIsPrimaryRoute(route: string) {
  const slot = useContext(Context);
  const hosted = useContext(HostedChrome);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return slot != null && hosted == null && pathname === routePath(route);
}
export function RouteControlsOutlet({
  slot: name = "controls",
  as = "span",
  className = "pe-appbar-controls",
}: {
  slot?: RouteControlName;
  as?: "span" | "div";
  className?: string;
}) {
  const slot = useContext(Context);
  const setElement = slot?.setElement;
  const ref = useCallback(
    (element: HTMLElement | null) => setElement?.(name, element),
    [setElement, name],
  );
  return as === "div" ? (
    <div ref={ref} className={className} />
  ) : (
    <span ref={ref} className={className} />
  );
}
/** A hidden Activity suspends this claim's effect; hosted routes keep their own local controls. */
export function PrimaryRouteControls({
  route,
  slot: name = "controls",
  children,
}: {
  route: string;
  slot?: RouteControlName;
  children: ReactNode;
}) {
  const slot = useContext(Context);
  const hosted = useContext(HostedChrome);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const token = useRef(Symbol(route)).current;
  const primary = hosted == null && pathname === routePath(route);
  const present = children != null && children !== false;
  const claim = slot?.claim;
  const release = slot?.release;
  useEffect(() => {
    if (!primary || !present || !claim || !release) return;
    claim(name, token);
    return () => release(name, token);
  }, [primary, present, claim, release, token, name]);
  if (!slot || !primary) return <>{children}</>;
  const element = slot.elements[name];
  return element && slot.owners[name] === token ? createPortal(children, element) : null;
}
