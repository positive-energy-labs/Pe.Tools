import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search, MessageSquare, Inbox, Server } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { HotkeyHint } from "#/components/lang/hotkey-command";
import { useScopeKeys } from "@pe/kit/keys";
import { ChromeSettings } from "./chrome-settings";
import { SituationDrawer } from "./situation-drawer";
import { locationLabel, admittedDestination } from "./model";
import { useDestination, useNavigation } from "./state";
import { GlobalSearch } from "./global-search";
import { RouteControlsSlot } from "./route-controls";
import { useRouteSlotPresence } from "./route-controls";
import { RouteHelpButton } from "#/route/help";
import { projectCaptionTheme, useSurfaceHost } from "./surface-host";
import { startFeedback } from "#/components/feedback-picker";
import "./app-bar.css";

type LaunchWindow = Window & {
  launchQueue?: { setConsumer: (consumer: (params: { targetURL?: string }) => void) => void };
};
export function AppBar() {
  const host = useSurfaceHost();
  const tray = host.surface === "tray";
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
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const measure = () => setCompact(node.clientWidth <= 700);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchField, setSearchField] = useState<HTMLInputElement | null>(null);
  const changeSearchOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const [launchRefusal, setLaunchRefusal] = useState<string | null>(null);
  const showSearch = () => {
    if (tray) return;
    refresh();
    setOpen(true);
    searchField?.focus();
  };
  useScopeKeys([
    ...(!tray
      ? [
          {
            hotkey: "Mod+Shift+K" as const,
            callback: showSearch,
            label: "Find tools, Works and Pea threads",
            options: { ignoreInputs: false },
          },
        ]
      : []),
    {
      hotkey: { key: ".", mod: true, shift: true },
      callback: () => startFeedback(),
      label: "Feedback",
      options: { ignoreInputs: false },
    },
  ]);
  const hasRouteHelp = useRouteSlotPresence("controls");
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
      projectCaptionTheme(
        color,
        getComputedStyle(node).color,
        document.documentElement.classList.contains("dark"),
      );
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
  const actions = (
    <>
      <RouteControlsSlot slot="palette" />
      <RouteControlsSlot />
      {!hasRouteHelp && (
        <RouteHelpButton
          name={label}
          docs="Home opens the tool directory. The route search chooses tools, saved Works and Pea threads. The page palette belongs to the current page; global Find searches tools, saved Works and Pea threads. Settings opens the real theme, feedback and machine controls."
        />
      )}
      <span className="pe-appbar-command-seam hairline-l" aria-hidden />
      <span id="pe-feedback-cancel" className="pe-feedback-cancel" />
      <ChromeSettings word={compact} />
    </>
  );
  useEffect(() => {
    document.title = `${import.meta.env.DEV ? "Pe.Tools Dev" : "Positive Energy"} / ${label}${currentWork ? ` / ${currentWork.label}` : ""}`;
  }, [label, currentWork?.label]);
  return (
    <>
      <div className="pe-appbar-shell hairline-b" data-surface="page">
        <nav
          ref={bar}
          aria-label="Global navigation"
          className="pe-appbar"
          data-surface="page"
          data-overlay={host.overlay}
          data-shell={host.surface}
          style={
            host.titlebarArea
              ? ({
                  "--app-titlebar-x": `${host.titlebarArea.x}px`,
                  "--app-titlebar-width": `${host.titlebarArea.width}px`,
                  "--app-titlebar-height": `${host.titlebarArea.height}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <div className="pe-appbar-row">
            {host.history === "window" && (
              <>
                <Button
                  label="Back"
                  icon={ArrowLeft}
                  refusal={
                    (host.native ? host.nativeHistory?.canGoBack : canGoBack)
                      ? undefined
                      : "No previous entry in this window's history"
                  }
                  onClick={() =>
                    host.native ? host.navigateNativeHistory("back") : router.history.back()
                  }
                />
                <Button
                  label="Forward"
                  icon={ArrowRight}
                  refusal={
                    (
                      host.native
                        ? host.nativeHistory?.canGoForward
                        : historyIndex < furthestHistory
                    )
                      ? undefined
                      : "No forward entry has been observed in this window"
                  }
                  onClick={() =>
                    host.native ? host.navigateNativeHistory("forward") : router.history.forward()
                  }
                />
              </>
            )}
            <Button
              label={host.surface === "tray" ? "Home / open work" : "Home / tool directory"}
              icon={<img src="/favicon.ico" alt="" aria-hidden width={16} height={16} />}
              onClick={() => navigateTo(host.homePath)}
              pressed={tray && location.pathname === "/open"}
            />
            <Button
              label={tray ? "Pea Inbox" : "Open Pea"}
              icon={tray ? Inbox : MessageSquare}
              pressed={tray && location.pathname === "/pea"}
              onClick={() => navigateTo("/pea")}
            />
            {tray && (
              <Button
                label="Machine"
                icon={Server}
                pressed={location.pathname === "/machine"}
                onClick={() => navigateTo("/machine")}
              />
            )}
            {!tray && (
              <div
                className="pe-appbar-route-search dl-control"
                data-selected={open || undefined}
                onClick={showSearch}
              >
                <Search aria-hidden className="pe-appbar-route-search-icon" />
                <Input
                  ref={setSearchField}
                  surface="embedded"
                  role="combobox"
                  aria-label="Choose product, Work or Pea thread"
                  aria-autocomplete="list"
                  aria-keyshortcuts="Control+Shift+K"
                  title="Search tools, Works and Pea threads · Ctrl+Shift+K"
                  aria-expanded={open}
                  placeholder={`${label}${currentWork ? ` / ${currentWork.label}` : ""}`}
                  value={open ? query : ""}
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
                <span className="pe-appbar-search-hint" aria-hidden>
                  <HotkeyHint hotkey="Mod+Shift+K" />
                </span>
              </div>
            )}
            <div
              className="pe-appbar-commands"
              data-compact={compact || undefined}
              role="group"
              aria-label="Situation, Page and Tutorial shortcuts"
            >
              <SituationDrawer barAnchor={bar.current} rail={compact ? actions : undefined} />
              {!compact && actions}
            </div>
          </div>
        </nav>
      </div>
      {(launchRefusal || host.navigationRefusal) && (
        <p role="status" className="px-3 py-1 text-ink-2">
          {launchRefusal || host.navigationRefusal}
        </p>
      )}
      {!tray && (
        <GlobalSearch
          open={open}
          onOpenChange={changeSearchOpen}
          onNavigate={navigateTo}
          anchor={searchField?.parentElement ?? null}
          query={query}
        />
      )}
    </>
  );
}
