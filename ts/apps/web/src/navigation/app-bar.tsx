import { useEffect, useRef, useState } from "react";
import { useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search, MessageSquare } from "lucide-react";
import { Button } from "#/components/lang/button";
import { Input } from "#/components/lang/input";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { ChromeSettings } from "./chrome-settings";
import { SituationDrawer } from "./situation-drawer";
import { locationLabel, admittedDestination } from "./model";
import { useDestination, useNavigation } from "./state";
import { GlobalSearch } from "./global-search";
import { RouteControlsSlot } from "./route-controls";
import { useRouteSlotPresence } from "./route-controls";
import { RouteHelpButton } from "#/route/help";
import "./app-bar.css";

type WindowOverlay = {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
  addEventListener: (event: "geometrychange", listener: () => void) => void;
  removeEventListener: (event: "geometrychange", listener: () => void) => void;
};
type LaunchWindow = Window & {
  launchQueue?: { setConsumer: (consumer: (params: { targetURL?: string }) => void) => void };
};
export function AppBar() {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const canGoBack = useCanGoBack();
  const historyIndex = location.state.__TSR_index;
  const [furthestHistory, setFurthestHistory] = useState(historyIndex);
  useEffect(
    () =>
      router.history.subscribe(({ action, location: next }) => {
        const index = next.state.__TSR_index;
        setFurthestHistory((prior) => (action.type === "PUSH" ? index : Math.max(prior, index)));
      }),
    [router],
  );
  const { snapshot, refresh } = useNavigation();
  const go = useDestination();
  const bar = useRef<HTMLElement>(null);
  const [overlay, setOverlay] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchField, setSearchField] = useState<HTMLInputElement | null>(null);
  const changeSearchOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const [launchRefusal, setLaunchRefusal] = useState<string | null>(null);
  const showSearch = () => {
    refresh();
    setOpen(true);
    searchField?.focus();
  };
  const hasRouteHelp = useRouteSlotPresence("controls");
  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const controls = (navigator as Navigator & { windowControlsOverlay?: WindowOverlay })
      .windowControlsOverlay;
    if (!controls) return;
    const update = () => {
      setOverlay(controls.visible);
    };
    update();
    controls.addEventListener("geometrychange", update);
    return () => controls.removeEventListener("geometrychange", update);
  }, []);
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const syncColor = () => {
      const color = getComputedStyle(node).backgroundColor;
      if (
        !color ||
        color === "transparent" ||
        (color.startsWith("rgba(") && color.endsWith(", 0)"))
      )
        return;
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.append(meta);
      }
      meta.content = color;
    };
    syncColor();
    const observer = new MutationObserver(syncColor);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", syncColor);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncColor);
    };
  }, []);
  useEffect(() => {
    const queue = (window as LaunchWindow).launchQueue;
    if (!queue) return;
    queue.setConsumer(({ targetURL }) => {
      if (!targetURL) return;
      const admitted = admittedDestination(targetURL, window.location.origin);
      if (admitted) {
        setLaunchRefusal(null);
        go(admitted);
      } else
        setLaunchRefusal("The launch destination was refused: it is not a same-origin app URL.");
    });
    return () => queue.setConsumer(() => {});
  }, [go]);
  const navigateTo = (url: string) => {
    if (go(url)) changeSearchOpen(false);
  };
  const currentWork = snapshot?.works.find((work) => {
    if (!work.url) return false;
    const destination = new URL(work.url, window.location.origin);
    return (
      destination.pathname === location.pathname &&
      [...destination.searchParams].every(
        ([key, value]) => String((location.search as Record<string, unknown>)[key] ?? "") === value,
      )
    );
  });
  const label = locationLabel(location.pathname);
  useEffect(() => {
    document.title = `Positive Energy / ${label}${currentWork ? ` / ${currentWork.label}` : ""}`;
  }, [label, currentWork?.label]);
  return (
    <>
      <div className="pe-appbar-shell hairline-b" data-surface="page">
        <nav
          ref={bar}
          aria-label="Global navigation"
          className="pe-appbar"
          data-surface="page"
          data-overlay={overlay}
        >
          <div className="pe-appbar-row">
            {(standalone || overlay) && (
              <>
                <Button
                  label="Back"
                  icon={ArrowLeft}
                  refusal={
                    canGoBack ? undefined : "No previous entry in this window's router history"
                  }
                  onClick={() => router.history.back()}
                />
                <Button
                  label="Forward"
                  icon={ArrowRight}
                  refusal={
                    historyIndex < furthestHistory
                      ? undefined
                      : "No forward entry has been observed in this window"
                  }
                  onClick={() => router.history.forward()}
                />
              </>
            )}
            <Button
              label="Home / tool directory"
              icon={<img src="/favicon.ico" alt="" aria-hidden width={16} height={16} />}
              onClick={() => navigateTo("/")}
            />
            <Button label="Open Pea" icon={MessageSquare} onClick={() => navigateTo("/pea")} />
            <div className="pe-appbar-route-search">
              <Input
                ref={setSearchField}
                surface="embedded"
                role="combobox"
                aria-label="Choose product, Work or Pea thread"
                aria-autocomplete="list"
                aria-expanded={open}
                placeholder={`${label}${currentWork ? ` / ${currentWork.label}` : ""}`}
                value={open ? query : ""}
                onClick={showSearch}
                onKeyDown={(event) => {
                  if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
                    event.preventDefault();
                    showSearch();
                  }
                }}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
              />
              <Search aria-hidden />
            </div>
            <div
              className="pe-appbar-commands"
              role="group"
              aria-label="Situation, Page, Find and Tutorial shortcuts"
            >
              <SituationDrawer />
              <RouteControlsSlot slot="palette" />
              <HotkeyCommand
                label="Find tools, Works and Pea threads"
                word="Find"
                hotkey="Mod+Shift+K"
                invoke={showSearch}
              />
              <RouteControlsSlot />
              {!hasRouteHelp && (
                <RouteHelpButton
                  name={label}
                  docs="Home opens the tool directory. The route search chooses tools, saved Works and Pea threads. The page palette belongs to the current page; global Find searches tools, saved Works and Pea threads. Settings opens the real theme, feedback and machine controls."
                />
              )}
            </div>
            <span className="pe-appbar-command-seam hairline-l" aria-hidden />
            <span id="pe-feedback-cancel" className="pe-feedback-cancel" />
            <ChromeSettings />
          </div>
        </nav>
      </div>
      {launchRefusal && (
        <p role="status" className="px-3 py-1 text-ink-2">
          {launchRefusal}
        </p>
      )}
      <GlobalSearch
        open={open}
        onOpenChange={changeSearchOpen}
        onNavigate={navigateTo}
        anchor={searchField}
        query={query}
      />
    </>
  );
}
