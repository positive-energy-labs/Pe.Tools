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

export type RouteSlotName = "controls" | "lamp" | "situation" | "palette" | "inspector";
export type SituationSignal = {
  kind: "archived" | "failure" | "busy" | "health" | "ready" | "unbound";
  tone: "nav" | "alarm" | "commit" | "caution" | "done";
  title: string;
  stamp: string;
};
type Slot = {
  elements: Partial<Record<RouteSlotName, HTMLElement | null>>;
  owners: Partial<Record<RouteSlotName, symbol | null>>;
  claim: (slot: RouteSlotName, owner: symbol) => void;
  release: (slot: RouteSlotName, owner: symbol) => void;
  setElement: (slot: RouteSlotName, element: HTMLElement | null) => void;
  pagePaletteOwner: symbol | null;
  setPagePaletteOwner: (owner: symbol) => void;
  clearPagePaletteOwner: (owner: symbol) => void;
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
const Context = createContext<Slot | null>(null);
export function useHasGlobalNavigation() {
  return useContext(Context) != null;
}
export function RouteControlsProvider({ children }: { children: ReactNode }) {
  const [elements, setElements] = useState<Slot["elements"]>({});
  const [owners, setOwners] = useState<Slot["owners"]>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pagePaletteOwner, setPagePaletteOwner] = useState<symbol | null>(null);
  const clearPagePaletteOwner = useCallback(
    (owner: symbol) => setPagePaletteOwner((prior) => (prior === owner ? null : prior)),
    [],
  );
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(false);
  const [signal, setSignal] = useState<Slot["signal"]>(null);
  const clearSignal = useCallback(
    (owner: symbol) => setSignal((prior) => (prior?.owner === owner ? null : prior)),
    [],
  );
  const setElement = useCallback(
    (slot: RouteSlotName, element: HTMLElement | null) =>
      setElements((prior) => (prior[slot] === element ? prior : { ...prior, [slot]: element })),
    [],
  );
  const claim = useCallback(
    (slot: RouteSlotName, owner: symbol) =>
      setOwners((prior) => (prior[slot] === owner ? prior : { ...prior, [slot]: owner })),
    [],
  );
  const release = useCallback(
    (slot: RouteSlotName, token: symbol) =>
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
        pagePaletteOwner,
        setPagePaletteOwner,
        clearPagePaletteOwner,
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
export function SituationPinnedSlot() {
  const context = useContext(Context);
  return <div ref={context?.setDockHost} className="pe-situation-dock" />;
}
export function useSituationDock() {
  const context = useContext(Context);
  if (!context) throw new Error("SituationDrawer requires RouteControlsProvider");
  return { dockHost: context.dockHost, pinned: context.pinned, setPinned: context.setPinned };
}
export function usePagePaletteOpen() {
  return useContext(Context)?.pagePaletteOwner != null;
}
/** Publish the real picker lifecycle; hidden Activities release the primary route claim. */
export function usePublishPagePalette(route: string, open: boolean) {
  const context = useContext(Context);
  const primary = useIsPrimaryRoute(route);
  const owner = useRef(Symbol(route)).current;
  const publish = context?.setPagePaletteOwner;
  const clear = context?.clearPagePaletteOwner;
  useEffect(() => {
    if (!primary || !open || !publish || !clear) return;
    publish(owner);
    return () => clear(owner);
  }, [primary, open, publish, clear, owner]);
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
export function useRouteSlotPresence(slot: RouteSlotName) {
  return Boolean(useContext(Context)?.owners[slot]);
}
export function useIsPrimaryRoute(route: string) {
  const slot = useContext(Context);
  const hosted = useContext(HostedChrome);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return slot != null && hosted == null && pathname === routePath(route);
}
export function RouteControlsSlot({
  slot: name = "controls",
  as = "span",
  className = "pe-appbar-controls",
}: {
  slot?: RouteSlotName;
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
  slot?: RouteSlotName;
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
