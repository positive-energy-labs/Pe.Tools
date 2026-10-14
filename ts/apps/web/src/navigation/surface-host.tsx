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
import {
  appRouteMount,
  SURFACE_SHELLS,
  type AppSurface,
  type SurfaceShell,
} from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { admittedDestination } from "./model";
import {
  nativeMessageSchema,
  postRendererMessage,
  type NativeWebView,
  type NativeMessageEvent,
} from "@pe/host-contracts/native-adapter";

type Overlay = {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(event: "geometrychange", listener: () => void): void;
  removeEventListener(event: "geometrychange", listener: () => void): void;
};
type NativeWindow = Window & {
  chrome?: {
    webview?: NativeWebView;
  };
};

export interface SurfaceHost {
  surface: AppSurface;
  /** What this surface's shell may do; the bar and the router read it, never the surface name. */
  shell: SurfaceShell;
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
  return appRouteMount(new URL(admitted, origin).pathname, surface) ? "local" : "window";
}

export function nativeNavigationHistory(message: unknown): SurfaceHost["nativeHistory"] {
  const parsed = nativeMessageSchema.safeParse(message);
  const value = parsed.success ? parsed.data : null;
  return value?.type === "navigation-history"
    ? { canGoBack: value.canGoBack, canGoForward: value.canGoForward }
    : null;
}

function navigateNativeHistory(direction: "back" | "forward"): boolean {
  const native = (window as NativeWindow).chrome?.webview;
  if (!native) return false;
  return postRendererMessage(native, { type: "navigate-history", direction });
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
  const parsed = nativeMessageSchema.safeParse(message);
  if (!parsed.success || parsed.data.type !== "titlebar-geometry" || !parsed.data.visible)
    return null;
  const area = parsed.data.rect;
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
    return postRendererMessage(native, { type: "open-window", url });
  }
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}

const webHost: SurfaceHost = {
  surface: "web",
  shell: SURFACE_SHELLS.web,
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
    postRendererMessage(native, { type: "chrome-theme", background, foreground: ink, dark });
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
    const syncNative = ({ data }: NativeMessageEvent) => {
      const parsed = nativeMessageSchema.safeParse(data);
      if (!parsed.success) return;
      if (parsed.data.type === "navigation-request") {
        navigationRequest.current(parsed.data.url);
        return;
      }
      const history = nativeNavigationHistory(data);
      if (history) {
        setNativeHistory(history);
        return;
      }
      if (parsed.data.type !== "titlebar-geometry") return;
      setNativeArea(
        nativeTitlebarArea(data, { width: window.innerWidth, height: window.innerHeight }),
      );
    };
    webview?.addEventListener("message", syncNative);
    postRendererMessage(webview, { type: "chrome-ready" });
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
  const local = SURFACE_SHELLS[surface].routes !== "all";
  useEffect(() => {
    document.documentElement.dataset.shell = surface;
  }, [surface]);
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
    if (!local) return;
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
  }, [surface, local, router, handoff]);
  useEffect(() => {
    if (!local) return;
    if (surfaceDestination(surface, location.href, window.location.origin) === "local") {
      lastTrayLocation.current = location.href;
      return;
    }
    navigationRequest.current(location.href);
    void router.navigate({ href: lastTrayLocation.current, replace: true, ignoreBlocker: true });
  }, [surface, local, location.href, router]);
  const value = useMemo<SurfaceHost>(
    () => ({
      surface,
      shell: SURFACE_SHELLS[surface],
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
  return (
    <Context value={value}>
      {children}
      {surface === "tray" ? <TrayScaleToggle /> : null}
    </Context>
  );
}

// ponytail: review-only. The tray type scale flips live (the corner badge, Ctrl+Alt+S, or ?scale=s1
// on load); a reload returns to S0. Delete this and the losing base.css block with the verdict.
const TRAY_SCALES = ["s0", "s1", "s2"];
function TrayScaleToggle() {
  const [scale, setScale] = useState("s0");
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("scale") ?? "";
    if (TRAY_SCALES.includes(asked)) setScale(asked);
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === "KeyS") next();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.trayScale = scale;
  }, [scale]);
  const next = () => setScale((s) => TRAY_SCALES[(TRAY_SCALES.indexOf(s) + 1) % 3]!);
  return (
    <div className="fixed bottom-0 left-0 z-dev">
      <Button label="Type scale" reason="Review only: S0 today, S1, S2 (Ctrl+Alt+S)" onClick={next}>
        {scale.toUpperCase()}
      </Button>
    </div>
  );
}

export const useSurfaceHost = () => use(Context);
