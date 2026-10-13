import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { appRouteMount, type AppSurface } from "@pe/agent-contracts";
import { admittedDestination } from "./model";

type Overlay = {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(event: "geometrychange", listener: () => void): void;
  removeEventListener(event: "geometrychange", listener: () => void): void;
};
type NativeWindow = Window & {
  chrome?: {
    webview?: {
      postMessage(message: string): void;
      addEventListener(event: "message", listener: (event: MessageEvent<unknown>) => void): void;
      removeEventListener(event: "message", listener: (event: MessageEvent<unknown>) => void): void;
    };
  };
};

export interface SurfaceHost {
  surface: AppSurface;
  history: "browser" | "window";
  homePath: "/" | "/open";
  settingsDoor: "quick" | "route";
  /** Caption drawing alone is insufficient: the page must receive usable geometry. */
  overlay: boolean;
  titlebarArea: Pick<DOMRect, "x" | "y" | "width" | "height"> | null;
  native: boolean;
  nativeHistory: { canGoBack: boolean; canGoForward: boolean } | null;
  navigateNativeHistory(direction: "back" | "forward"): boolean;
  openFullWindow(destination: string): boolean;
  navigationRefusal: string | null;
}

/** One destination policy for router changes, ordinary links and native document navigation. */
export function surfaceDestination(
  surface: AppSurface,
  destination: string,
  origin: string,
): "local" | "window" | null {
  const admitted = admittedDestination(destination, origin);
  if (!admitted) return null;
  return surface === "tray" && !appRouteMount(new URL(admitted, origin).pathname, "tray")
    ? "window"
    : "local";
}

export function nativeNavigationHistory(message: unknown): SurfaceHost["nativeHistory"] {
  if (typeof message !== "object" || message === null) return null;
  const value = message as Record<string, unknown>;
  return value.type === "navigation-history" &&
    typeof value.canGoBack === "boolean" &&
    typeof value.canGoForward === "boolean"
    ? { canGoBack: value.canGoBack, canGoForward: value.canGoForward }
    : null;
}

function navigateNativeHistory(direction: "back" | "forward"): boolean {
  const native = (window as NativeWindow).chrome?.webview;
  if (!native) return false;
  native.postMessage(JSON.stringify({ type: "navigate-history", direction }));
  return true;
}

export function usableOverlay(
  visible: boolean,
  rect: Pick<DOMRect, "x" | "y" | "width" | "height">,
) {
  return (
    visible &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** Native frame measurements are a separate surface capability, not a browser WCO polyfill. */
export function nativeTitlebarArea(
  message: unknown,
  viewport: { width: number; height: number },
): SurfaceHost["titlebarArea"] {
  if (typeof message !== "object" || message === null) return null;
  const value = message as Record<string, unknown>;
  if (value.type !== "titlebar-geometry" || value.visible !== true) return null;
  if (typeof value.rect !== "object" || value.rect === null) return null;
  const rect = value.rect as Record<string, unknown>;
  if (![rect.x, rect.y, rect.width, rect.height].every((entry) => typeof entry === "number"))
    return null;
  const area = rect as NonNullable<SurfaceHost["titlebarArea"]>;
  return usableOverlay(true, area) &&
    area.x + area.width <= viewport.width &&
    area.y + area.height <= viewport.height
    ? { x: area.x, y: area.y, width: area.width, height: area.height }
    : null;
}

/** Presentation state never changes the resource address handed to another surface. */
export function fullWindowDestination(destination: string, origin: string): string | null {
  const admitted = admittedDestination(destination, origin);
  if (!admitted) return null;
  const url = new URL(admitted, origin);
  url.searchParams.delete("shell");
  return url.href;
}

function openFullWindow(destination: string): boolean {
  const url = fullWindowDestination(destination, window.location.origin);
  if (!url) return false;
  const native = (window as NativeWindow).chrome?.webview;
  if (native) {
    native.postMessage(JSON.stringify({ type: "open-window", url }));
    return true;
  }
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}

const webHost: SurfaceHost = {
  surface: "web",
  history: "browser",
  homePath: "/",
  settingsDoor: "quick",
  overlay: false,
  titlebarArea: null,
  native: false,
  nativeHistory: null,
  navigateNativeHistory,
  openFullWindow,
  navigationRefusal: null,
};
const Context = createContext<SurfaceHost>(webHost);

/** Windows COLORREF uses red in the low byte. Reject translucent or invalid CSS colors. */
export function captionColor(color: string): number | null {
  const match = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(color);
  if (!match) return null;
  const [red, green, blue] = match.slice(1).map(Number);
  if ([red, green, blue].some((channel) => channel > 255)) return null;
  return red! | (green! << 8) | (blue! << 16);
}

export function projectCaptionTheme(backgroundColor: string, foreground: string, dark: boolean) {
  const native = (window as NativeWindow).chrome?.webview;
  const background = captionColor(backgroundColor);
  const ink = captionColor(foreground);
  if (native && background !== null && ink !== null)
    native.postMessage(JSON.stringify({ type: "chrome-theme", background, foreground: ink, dark }));
}

export function SurfaceHostProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const shell = location.search.shell;
  const navigationRequest = useRef<(destination: string) => void>(() => {});
  const lastTrayLocation = useRef("/open?shell=tray");
  const [navigationRefusal, setNavigationRefusal] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [browserArea, setBrowserArea] = useState<SurfaceHost["titlebarArea"]>(null);
  const [nativeArea, setNativeArea] = useState<SurfaceHost["titlebarArea"]>(null);
  const [native, setNative] = useState(false);
  const [nativeHistory, setNativeHistory] = useState<SurfaceHost["nativeHistory"]>(null);
  useEffect(() => {
    const webview = (window as NativeWindow).chrome?.webview;
    setNative(!!webview);
    const syncNative = ({ data }: MessageEvent<unknown>) => {
      if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        data.type === "navigation-request" &&
        "url" in data &&
        typeof data.url === "string"
      ) {
        navigationRequest.current(data.url);
        return;
      }
      const history = nativeNavigationHistory(data);
      if (history) {
        setNativeHistory(history);
        return;
      }
      if (
        typeof data !== "object" ||
        data === null ||
        !("type" in data) ||
        data.type !== "titlebar-geometry"
      )
        return;
      setNativeArea(
        nativeTitlebarArea(data, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    webview?.addEventListener("message", syncNative);
    webview?.postMessage(JSON.stringify({ type: "chrome-ready" }));
    const media = matchMedia("(display-mode: standalone)");
    const syncMode = () => setStandalone(media.matches);
    syncMode();
    media.addEventListener("change", syncMode);
    const controls = (navigator as Navigator & { windowControlsOverlay?: Overlay })
      .windowControlsOverlay;
    const syncOverlay = () => {
      const rect = controls?.getTitlebarAreaRect();
      const usable = !!controls && !!rect && usableOverlay(controls.visible, rect);
      setBrowserArea(
        usable && rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      );
    };
    syncOverlay();
    controls?.addEventListener("geometrychange", syncOverlay);
    return () => {
      webview?.removeEventListener("message", syncNative);
      media.removeEventListener("change", syncMode);
      controls?.removeEventListener("geometrychange", syncOverlay);
    };
  }, []);
  const titlebarArea = native ? nativeArea : browserArea;
  const overlay = titlebarArea !== null;
  const open = useCallback(openFullWindow, []);
  const surface: AppSurface = shell === "tray" ? "tray" : standalone || overlay ? "pwa" : "web";
  const handoff = useCallback((destination: string) => {
    const opened = openFullWindow(destination);
    setNavigationRefusal(
      opened ? null : "The full window could not be opened. The tray stayed on its current route.",
    );
    return opened;
  }, []);
  navigationRequest.current = (destination) => {
    const mode = surfaceDestination(surface, destination, window.location.origin);
    if (mode === "window") {
      handoff(destination);
      return;
    }
    if (!mode) {
      setNavigationRefusal("This destination is not a registered app route.");
      return;
    }
    const url = new URL(destination, window.location.origin);
    const search = Object.fromEntries(url.searchParams);
    void router.navigate({
      to: url.pathname,
      search: { ...search, shell: surface === "tray" ? "tray" : undefined },
      hash: url.hash.slice(1),
    });
  };
  useEffect(() => {
    if (surface !== "tray") return;
    const decide = (destination: string) =>
      surfaceDestination(surface, destination, window.location.origin);
    const unblock = router.history.block({
      enableBeforeUnload: false,
      blockerFn: ({ nextLocation }) => {
        const mode = decide(nextLocation.href);
        if (mode === "local") return false;
        if (mode === "window") handoff(nextLocation.href);
        else setNavigationRefusal("This destination is not a registered app route.");
        return true;
      },
    });
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.target instanceof Node === false)
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download")) return;
      const mode = decide(anchor.href);
      if (!mode) return;
      event.preventDefault();
      navigationRequest.current(anchor.href);
    };
    document.addEventListener("click", click);
    return () => {
      unblock();
      document.removeEventListener("click", click);
    };
  }, [surface, router, handoff]);
  useEffect(() => {
    if (surface !== "tray") return;
    if (surfaceDestination(surface, location.href, window.location.origin) === "local") {
      lastTrayLocation.current = location.href;
      return;
    }
    navigationRequest.current(location.href);
    void router.navigate({ href: lastTrayLocation.current, replace: true, ignoreBlocker: true });
  }, [surface, location.href, router]);
  const value = useMemo<SurfaceHost>(
    () => ({
      surface,
      history: surface === "web" ? "browser" : "window",
      homePath: surface === "tray" ? "/open" : "/",
      settingsDoor: surface === "tray" ? "route" : "quick",
      overlay,
      titlebarArea,
      native,
      nativeHistory,
      navigateNativeHistory,
      openFullWindow: open,
      navigationRefusal,
    }),
    [surface, overlay, titlebarArea, native, nativeHistory, open, navigationRefusal],
  );
  return <Context value={value}>{children}</Context>;
}

export const useSurfaceHost = () => use(Context);
