/**
 * THROWAWAY protoui round 3 shared body for 2d and 2e: the tray is a router. The top bar copies the
 * web app bar's left cluster (Back/Forward, Home, route buttons, route field showing `Route / item`),
 * settings sits where ChromeSettings sits, and the page body below is the selected route.
 * Fixture-only. navigation/app-bar.tsx needs the router, so only its CSS classes are reused.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Cloud,
  Download,
  FolderOpen,
  Inbox,
  Laptop,
  MessageSquare,
  HelpCircle,
  Minus,
  Pin,
  PinOff,
  Play,
  Power,
  Search,
  Settings2,
  Share2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@pe/kit/lang/button";
import { CommandPalette } from "@pe/kit/lang/list-popup";
import { Input } from "@pe/kit/lang/input";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { KeyHint } from "@pe/kit/lang/key-hint";
import "#/navigation/app-bar.css";

import {
  activityWord,
  GenericDetail,
  MiddlePane,
  PROPOSALS,
  ProposalDetail,
  THREADS,
  ThreadDetail,
} from "./variant-2b";

type Route = "inbox" | "work" | "revit";
type Spot = { route: Route; selected: string };
type Land = Spot | "settings" | null;
type Hit = {
  key: string;
  kind: string;
  label: string;
  aside: string;
  state: string;
  icon: LucideIcon;
  land: Land;
  verb: string;
};

const ROUTES: { id: Route; label: string; icon: LucideIcon; first: string }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox, first: "finished" },
  { id: "work", label: "Work", icon: Wrench, first: "suggestion" },
  { id: "revit", label: "Revit", icon: Laptop, first: "session-2025" },
];

/** The short name shown after the route in the field, like the app bar's `label / work`. */
function itemName(spot: Spot): string | null {
  if (spot.route === "inbox") return THREADS.find((t) => t.id === spot.selected)?.title ?? null;
  if (spot.route === "work")
    return PROPOSALS.find((p) => p.id === spot.selected)?.target.split(" · ")[0] ?? null;
  if (spot.selected.startsWith("session-")) return `Revit ${spot.selected.slice(8)}`;
  if (spot.selected.startsWith("launch-")) return `Launch ${spot.selected.slice(7)}`;
  return null;
}

function hits(withRoutes: boolean): Hit[] {
  const list: Hit[] = [];
  if (withRoutes) {
    for (const r of ROUTES)
      list.push({
        key: `r-${r.id}`,
        kind: "Routes",
        label: r.label,
        aside: "Tray route",
        state: "route",
        icon: r.icon,
        land: { route: r.id, selected: r.first },
        verb: "Go",
      });
    list.push({
      key: "r-settings",
      kind: "Routes",
      label: "Settings",
      aside: "Machine, update, share, account",
      state: "menu",
      icon: Settings2,
      land: "settings",
      verb: "Open",
    });
  }
  for (const t of THREADS)
    list.push({
      key: `t-${t.id}`,
      kind: t.activity === "running" ? "Work" : "Needs you",
      label: t.title,
      aside: `${t.harness} · ${t.target}`,
      state: activityWord[t.activity],
      icon: MessageSquare,
      land: { route: "inbox", selected: t.id },
      verb: "Open thread",
    });
  for (const p of PROPOSALS)
    list.push({
      key: `p-${p.id}`,
      kind: "Work",
      label: p.title,
      aside: p.target,
      state: "Proposal",
      icon: Wrench,
      land: { route: "work", selected: p.id },
      verb: "Review",
    });
  list.push(
    {
      key: "s-2025",
      kind: "Revit",
      label: "Revit 2025 · dev",
      aside: "Lakeside Clinic.rvt",
      state: "controlled",
      icon: Laptop,
      land: { route: "revit", selected: "session-2025" },
      verb: "Show session",
    },
    {
      key: "s-2024",
      kind: "Revit",
      label: "Revit 2024 · installed",
      aside: "Tower A.rvt",
      state: "observed",
      icon: Laptop,
      land: { route: "revit", selected: "session-2024" },
      verb: "Show session",
    },
  );
  for (const y of [2024, 2025, 2026])
    list.push({
      key: `l-${y}`,
      kind: "Revit",
      label: `Launch Revit ${y}`,
      aside: "Start a new session",
      state: "ready",
      icon: Play,
      land: { route: "revit", selected: `launch-${y}` },
      verb: "Select",
    });
  list.push(
    {
      key: "m-update",
      kind: "Machine",
      label: "Update",
      aside: "0.7.24 · up to date",
      state: "current",
      icon: Download,
      land: "settings",
      verb: "Open settings",
    },
    {
      key: "m-share",
      kind: "Machine",
      label: "Share this machine",
      aside: "Private",
      state: "refused",
      icon: Share2,
      land: "settings",
      verb: "Open settings",
    },
    {
      key: "m-quit",
      kind: "Machine",
      label: "Quit host",
      aside: "pid 42824",
      state: "running",
      icon: Power,
      land: "settings",
      verb: "Open settings",
    },
    {
      key: "a-families",
      kind: "App",
      label: "Open Families",
      aside: "Route /families",
      state: "route",
      icon: FolderOpen,
      land: null,
      verb: "Open",
    },
    {
      key: "a-pea",
      kind: "App",
      label: "Open Pea",
      aside: "Route /pea",
      state: "route",
      icon: FolderOpen,
      land: null,
      verb: "Open",
    },
  );
  return list;
}

/** One settings button; the popover holds everything the old Machine route held. */
function TraySettings({
  open,
  onOpenChange,
  say,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  say: (text: string) => void;
}) {
  const [login, setLogin] = useState(true);
  const line = (
    icon: LucideIcon,
    label: string,
    state: string,
    verb?: string,
    tone?: "caution" | "alarm",
  ) => {
    const Icon = icon;
    return (
      <div className="flex items-center gap-2 px-2 py-1 t-small">
        <Icon aria-hidden className="size-3.5 shrink-0 text-ink-2" />
        <span className="w-20 shrink-0 font-semibold">{label}</span>
        <span className="min-w-0 flex-1 truncate face-mono text-ink-2" data-tone={tone}>
          {state}
        </span>
        {verb ? (
          <Button label={`${verb} ${label}`} onClick={() => say(`${verb} · ${label}`)}>
            {verb}
          </Button>
        ) : null}
      </div>
    );
  };
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger render={<Button label="Settings" icon={Settings2} data-chrome-settings />} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="page"
            className="float-surface w-80 p-1"
            role="dialog"
            aria-label="Settings menu"
          >
            <p className="px-2 pt-1 t-small t-upper text-ink-2">
              Pe.Tools 0.7.24 · installed · up 11 h
            </p>
            {line(Download, "Update", "up to date", "Check")}
            {line(Share2, "Share", "refused · private", "Inspect", "alarm")}
            {line(Cloud, "Providers", "Claude · Codex ready", "Manage")}
            {line(Bell, "Account", "not signed in", "Sign in", "caution")}
            <div className="flex items-center gap-2 px-2 py-1 t-small">
              <Power aria-hidden className="size-3.5 shrink-0 text-ink-2" />
              <span className="w-20 shrink-0 font-semibold">At login</span>
              <span className="flex-1 face-mono text-ink-2">{login ? "on" : "off"}</span>
              <Button label="Start at login" pressed={login} onClick={() => setLogin((v) => !v)}>
                {login ? "On" : "Off"}
              </Button>
            </div>
            <div className="hairline-t mt-1 flex gap-1.5 p-1.5">
              <Button
                kind="framed"
                label="Open full window"
                onClick={() => say("Open full window")}
              >
                Open window
              </Button>
              <Button label="Quit host" data-tone="alarm" onClick={() => say("Quit host")}>
                Quit host
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TrayRoutes({ mode }: { mode: "buttons" | "appbar" }) {
  const [trail, setTrail] = useState<{ stack: Spot[]; at: number }>({
    stack: [{ route: "inbox", selected: "finished" }],
    at: 0,
  });
  const spot = trail.stack[trail.at];
  const [open, setOpen] = useState(mode === "appbar");
  const [query, setQuery] = useState("");
  const [field, setField] = useState<HTMLInputElement | null>(null);
  const [settings, setSettings] = useState(false);
  const [pinned, setPinned] = useState(true);
  const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
  const [outcome, setOutcome] = useState("");

  const go = (next: Spot) =>
    setTrail((t) => ({ stack: [...t.stack.slice(0, t.at + 1), next], at: t.at + 1 }));
  const select = (selected: string) => go({ route: spot.route, selected });
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  const showSearch = () => {
    setOpen(true);
    field?.focus();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        field?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [field]);

  const items = useMemo(() => hits(mode === "appbar"), [mode]);
  const item = itemName(spot);
  const routeName = ROUTES.find((r) => r.id === spot.route)!.label;
  const placeholder = `${routeName}${item ? ` / ${item}` : ""}`;
  const noop = () => undefined;
  const body =
    spot.route === "inbox" ? (
      <ThreadDetail id={spot.selected} onOutcome={setOutcome} />
    ) : spot.route === "work" ? (
      <ProposalDetail onOutcome={setOutcome} />
    ) : (
      <GenericDetail place="revit" selected={spot.selected} onOutcome={setOutcome} />
    );

  const routeField = (style?: CSSProperties) => (
    <div
      className="pe-appbar-route-search"
      data-selected={open || undefined}
      onClick={showSearch}
      style={{ ...style, WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <TooltipHint content="Search routes, Work and threads · Ctrl+K">
        <Input
          ref={setField}
          surface="embedded"
          role="combobox"
          aria-label="Choose route, Work or Pea thread"
          aria-autocomplete="list"
          aria-expanded={open}
          placeholder={placeholder}
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
      </TooltipHint>
      <span className="pe-appbar-search-hint" aria-hidden>
        <KeyHint mute>Ctrl K</KeyHint>
        <Search aria-hidden />
      </span>
    </div>
  );

  return (
    <div data-surface="page" className="relative flex size-full flex-col overflow-hidden text-ink">
      {/* OWED: WebView2 window chrome needs a shared draggable title-bar primitive and native hit-test contract. */}
      {mode === "appbar" ? (
        <header
          className="hairline-b flex h-9 shrink-0 items-center gap-1 pl-1"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        >
          <div className="flex items-center gap-1" style={noDrag}>
            <Button
              label="Back"
              icon={ArrowLeft}
              refusal={trail.at > 0 ? undefined : "No previous entry in this window"}
              onClick={() => setTrail((t) => ({ ...t, at: t.at - 1 }))}
            />
            <Button
              label="Forward"
              icon={ArrowRight}
              refusal={trail.at < trail.stack.length - 1 ? undefined : "No forward entry"}
              onClick={() => setTrail((t) => ({ ...t, at: t.at + 1 }))}
            />
            <Button
              label="Home / tray"
              icon={
                <span className="grid size-4 place-content-center rounded-sm bg-ink text-[8px] font-bold text-on">
                  Pe
                </span>
              }
              onClick={() => go({ route: "inbox", selected: "finished" })}
            />
            <Button
              label="Open Pea"
              icon={MessageSquare}
              onClick={() => go({ route: "inbox", selected: "finished" })}
            />
          </div>
          {routeField({ flex: "1 1 0", maxWidth: "22rem", marginInlineEnd: "auto" })}
          <div
            className="flex items-center gap-1"
            style={noDrag}
            role="group"
            aria-label="Route shortcuts"
          >
            <Button
              label={`${routeName} help`}
              icon={HelpCircle}
              onClick={() => setOutcome(`${routeName} help`)}
            />
          </div>
          <span className="pe-appbar-command-seam hairline-l h-4" aria-hidden />
          <div style={noDrag}>
            <TraySettings open={settings} onOpenChange={setSettings} say={setOutcome} />
          </div>
          {/* OWED: WebView2 draws no caption buttons in the WCO area; these are ours, sized like the native 138px area. */}
          <div
            className="hairline-l ml-1 flex h-full w-[138px] shrink-0"
            style={noDrag}
            role="group"
            aria-label="Window controls"
          >
            <TooltipHint content="Minimize">
              <button
                type="button"
                aria-label="Minimize"
                onClick={() => setOutcome("Minimize requested")}
                className="grid w-[46px] cursor-default place-content-center text-ink hover:bg-ink/10"
              >
                <Minus aria-hidden strokeWidth={1} className="size-4" />
              </button>
            </TooltipHint>
            <TooltipHint content="Keep on top">
              <button
                type="button"
                aria-label="Keep on top"
                aria-pressed={pinned}
                onClick={() => setPinned((v) => !v)}
                className="grid w-[46px] cursor-default place-content-center text-ink hover:bg-ink/10"
              >
                {pinned ? (
                  <Pin aria-hidden strokeWidth={1} className="size-4" />
                ) : (
                  <PinOff aria-hidden strokeWidth={1} className="size-4" />
                )}
              </button>
            </TooltipHint>
            <TooltipHint content="Close">
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOutcome("Close requested")}
                className="grid w-[46px] cursor-default place-content-center text-ink hover:bg-[#c42b1c] hover:text-document"
              >
                <X aria-hidden strokeWidth={1} className="size-4" />
              </button>
            </TooltipHint>
          </div>
        </header>
      ) : (
        <header className="hairline-b flex h-9 shrink-0 items-center gap-1 px-1">
          {mode === "buttons" ? (
            <>
              <Button
                label="Back"
                icon={ArrowLeft}
                refusal={trail.at > 0 ? undefined : "No previous entry in this window"}
                onClick={() => setTrail((t) => ({ ...t, at: t.at - 1 }))}
              />
              <Button
                label="Forward"
                icon={ArrowRight}
                refusal={trail.at < trail.stack.length - 1 ? undefined : "No forward entry"}
                onClick={() => setTrail((t) => ({ ...t, at: t.at + 1 }))}
              />
            </>
          ) : null}
          <Button
            label="Home / tray"
            icon={
              <span className="grid size-4 place-content-center rounded-sm bg-ink text-[8px] font-bold text-on">
                Pe
              </span>
            }
            onClick={() => go({ route: "inbox", selected: "finished" })}
          />
          {mode === "buttons"
            ? ROUTES.map((r) => (
                <Button
                  key={r.id}
                  label={`Open ${r.label}`}
                  icon={r.icon}
                  pressed={spot.route === r.id}
                  onClick={() => go({ route: r.id, selected: r.first })}
                />
              ))
            : null}
          {routeField(
            mode === "buttons"
              ? { flex: "1 1 0", maxWidth: "26rem", marginInlineEnd: 0 }
              : undefined,
          )}
          <div
            className="h-full min-w-4 flex-1 truncate px-2 face-mono t-small leading-9 text-ink-2"
            style={{ WebkitAppRegion: "drag" } as CSSProperties}
          >
            {outcome}
          </div>
          <TraySettings open={settings} onOpenChange={setSettings} say={setOutcome} />
          <span className="hairline-l mx-0.5 h-4" aria-hidden />
          <Button label="Pin window" icon={Pin} pressed />
          <Button label="Minimize" icon={Minus} onClick={() => setOutcome("Minimize requested")} />
          <Button label="Close" icon={X} onClick={() => setOutcome("Close requested")} />
        </header>
      )}
      <div
        key={spot.route}
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: "260px minmax(0, 1fr)" }}
      >
        <aside className="hairline-r flex min-h-0 flex-col">
          <MiddlePane place={spot.route} selected={spot.selected} onSelect={select} />
        </aside>
        <main className="min-h-0 min-w-0">{body}</main>
      </div>
      <CommandPalette<Hit>
        open={open}
        onOpenChange={changeOpen}
        presentation="anchored"
        anchor={field}
        query={query}
        aria-label="Find anything in Pe.Tools"
        items={items}
        keyOf={(hit) => hit.key}
        labelOf={(hit) => `${hit.label} ${hit.aside} ${hit.state} ${hit.kind}`}
        groupOf={(hit) => hit.kind}
        filter="fuzzy"
        searchAbove={0}
        searchPlaceholder="Search routes, threads, Work and Revit"
        empty="Nothing to find"
        noMatch="No matching route, thread, Work or Revit"
        maxHeight="min(22rem, 60dvh)"
        onPick={(hit) => {
          if (hit.land === "settings") setSettings(true);
          else if (hit.land) go(hit.land);
          else setOutcome(`${hit.verb} · ${hit.label} (fixture)`);
        }}
        row={(hit) => {
          const Icon = hit.icon;
          return {
            lead: <Icon aria-hidden className="size-3.5" />,
            label: hit.label,
            aside: hit.aside,
            meta: (
              <span
                className="face-mono"
                data-tone={
                  hit.state === "Failed" || hit.state === "refused"
                    ? "alarm"
                    : hit.state === "Waiting"
                      ? "caution"
                      : undefined
                }
              >
                {hit.state}
              </span>
            ),
            title: `${hit.verb} · ${hit.aside}`,
          };
        }}
        footer={
          <div
            className="flex items-center justify-end gap-1.5 px-1 pb-1 t-small text-ink-2"
            onClick={noop}
          >
            <KeyHint>↑↓</KeyHint> move <KeyHint hotkey="Enter" /> choose <KeyHint hotkey="Escape" />{" "}
            close
          </div>
        }
      />
    </div>
  );
}
