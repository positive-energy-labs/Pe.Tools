/**
 * THROWAWAY protoui variant 2a — "Palette is the sidebar": variant 2's middle pane is the
 * inline body of the shared CommandPalette, and its rail selects that palette's scope.
 * Fixture-only. Delete with the control-surface lineup after the round.
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bell,
  Check,
  ChevronsRight,
  Cloud,
  Download,
  Inbox,
  Layers3,
  Laptop,
  MessageSquare,
  Minus,
  Pin,
  Play,
  RotateCcw,
  Send,
  Settings,
  Share2,
  Square,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { Kbd } from "#/components/lang/kbd";
import { List } from "@pe/kit/lang/list-popup";
import { ProviderMark } from "#/components/lang/provider-mark";
import { Row } from "@pe/kit/lang/row";
import type { Collection } from "@pe/kit/lang/collection";

import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = {
  id: "2a",
  label: "Palette is the sidebar",
  width: 760,
  height: 560,
};

type Scope = "all" | "inbox" | "work" | "revit" | "machine";
type Activity = "waiting" | "finished" | "failed" | "running";
type Group = "Needs you" | "Running" | "Launch" | "Machine";
type Thread = {
  id: string;
  title: string;
  target: string;
  age: string;
  harness: "claude" | "codex";
  activity: Activity;
  unread?: boolean;
};
type PaletteItem = {
  id: string;
  scope: Exclude<Scope, "all">;
  group: Group;
  label: string;
  search: string;
  sub: string;
  state: string;
  verb: string;
  icon?: LucideIcon;
  harness?: Thread["harness"];
  tone?: "alarm" | "caution";
};

// OWED: the real tray needs one mixed palette projection typed from thread, Work, session, and
// machine contracts. These fixtures only exercise the shared List/CommandPalette row contract.
const THREADS: Thread[] = [
  {
    id: "finished",
    title: "Clean the sheet index",
    target: "Lakeside Clinic.rvt",
    age: "4m",
    harness: "codex",
    activity: "finished",
    unread: true,
  },
  {
    id: "approval",
    title: "Retag supply diffusers",
    target: "Tower A · Level 03",
    age: "9m",
    harness: "claude",
    activity: "waiting",
  },
  {
    id: "failed",
    title: "Export duct schedule",
    target: "Harbor Lab Central.rvt",
    age: "24m",
    harness: "codex",
    activity: "failed",
    unread: true,
  },
  {
    id: "running",
    title: "Audit family parameters",
    target: "Office Fitout.rvt",
    age: "now",
    harness: "claude",
    activity: "running",
  },
];

const ITEMS: readonly PaletteItem[] = [
  ...THREADS.map(
    (thread): PaletteItem => ({
      id: thread.id,
      scope: "inbox",
      group: thread.activity === "running" ? "Running" : "Needs you",
      label: thread.title,
      search: `${thread.title} ${thread.target} ${thread.harness} ${thread.activity}`,
      sub: `${thread.target} · ${thread.harness} · fixture`,
      state: `${thread.activity === "waiting" ? "Waiting" : thread.activity[0]!.toUpperCase() + thread.activity.slice(1)}${thread.unread ? " · unread" : ""}`,
      verb:
        thread.activity === "waiting"
          ? "answer"
          : thread.activity === "failed"
            ? "inspect"
            : "open",
      harness: thread.harness,
      tone:
        thread.activity === "failed"
          ? "alarm"
          : thread.activity === "waiting"
            ? "caution"
            : undefined,
    }),
  ),
  {
    id: "proposal",
    scope: "work",
    group: "Needs you",
    label: "HCB diffuser migration",
    search: "hcb diffuser migration family foundry proposal review three changes",
    sub: "HCB-48 · Family Foundry",
    state: "3 changes",
    verb: "review",
    icon: Wrench,
    tone: "caution",
  },
  {
    id: "rtu",
    scope: "work",
    group: "Needs you",
    label: "Rooftop unit cleanup",
    search: "rtu rooftop unit cleanup proposal six changes",
    sub: "RTU-07 · Family Foundry",
    state: "6 changes",
    verb: "review",
    icon: Wrench,
    tone: "caution",
  },
  {
    id: "session-2025",
    scope: "revit",
    group: "Running",
    label: "2025 · dev",
    search: "revit 2025 dev lakeside clinic controlled session",
    sub: "Lakeside Clinic.rvt · controlled",
    state: "ready",
    verb: "show",
    icon: Laptop,
  },
  {
    id: "session-2024",
    scope: "revit",
    group: "Running",
    label: "2024 · installed",
    search: "revit 2024 installed tower observed session",
    sub: "Tower A.rvt · observed",
    state: "ready",
    verb: "show",
    icon: Laptop,
  },
  ...([2024, 2025, 2026] as const).map(
    (year): PaletteItem => ({
      id: `launch-${year}`,
      scope: "revit",
      group: "Launch",
      label: `Revit ${year}`,
      search: `launch start revit ${year}`,
      sub: "Start a new session",
      state: "ready",
      verb: "launch",
      icon: Play,
    }),
  ),
  {
    id: "m-update",
    scope: "machine",
    group: "Machine",
    label: "Update",
    search: "machine update pe tools version current",
    sub: "Pe.Tools 0.7.24",
    state: "up to date",
    verb: "check",
    icon: Download,
  },
  {
    id: "m-share",
    scope: "machine",
    group: "Machine",
    label: "Share",
    search: "machine share private refused",
    sub: "This machine is private",
    state: "refused",
    verb: "inspect",
    icon: Share2,
    tone: "alarm",
  },
  {
    id: "m-providers",
    scope: "machine",
    group: "Machine",
    label: "Providers",
    search: "machine pea providers claude codex",
    sub: "Claude · Codex",
    state: "2 of 2",
    verb: "manage",
    icon: Cloud,
  },
  {
    id: "m-account",
    scope: "machine",
    group: "Machine",
    label: "Account",
    search: "machine account cloud auth sign in",
    sub: "Cloud identity",
    state: "not signed in",
    verb: "open",
    icon: Bell,
    tone: "caution",
  },
];

const RAIL: { id: Scope; label: string; icon: LucideIcon; count?: number }[] = [
  { id: "all", label: "All", icon: Layers3, count: 3 },
  { id: "inbox", label: "Inbox", icon: Inbox, count: 3 },
  { id: "work", label: "Work", icon: Wrench, count: 2 },
  { id: "revit", label: "Revit", icon: Laptop, count: 2 },
  { id: "machine", label: "Machine", icon: Settings, count: 1 },
];

function RailButton({
  item,
  current,
  onPick,
}: {
  item: (typeof RAIL)[number];
  current: Scope;
  onPick: () => void;
}) {
  const Icon = item.icon;
  return (
    <span className="relative flex justify-center">
      <Button
        label={`${item.label} palette`}
        icon={Icon}
        pressed={current === item.id}
        onClick={onPick}
      />
      {item.count ? (
        <span
          className="pointer-events-none absolute right-0 top-0 grid min-w-3 place-content-center rounded-full px-0.5 face-mono text-[9px] leading-3"
          data-tone={item.id === "machine" ? "caution" : undefined}
          aria-label={`${item.count} ${item.label}`}
        >
          {item.count}
        </span>
      ) : null}
    </span>
  );
}

function PalettePane({
  scope,
  selected,
  initialQuery,
  onPick,
  onEverywhere,
}: {
  scope: Scope;
  selected: string;
  initialQuery: string;
  onPick: (item: PaletteItem) => void;
  onEverywhere: (query: string) => void;
}) {
  const collection = useRef<Collection<PaletteItem> | null>(null);
  const rows = scope === "all" ? ITEMS : ITEMS.filter((item) => item.scope === scope);
  const label = RAIL.find((item) => item.id === scope)?.label ?? "All";
  return (
    <>
      {/* List is the inline body used by CommandPalette. OWED: CommandPalette needs a first-class
          presentation="inline" prop so tray and hotkey presentations share one named component. */}
      <List<PaletteItem>
        key={`${scope}:${initialQuery}`}
        aria-label={`${label} palette`}
        items={rows}
        keyOf={(item) => item.id}
        labelOf={(item) => item.search}
        groupOf={scope === "all" ? (item) => item.group : undefined}
        groupCounts={false}
        filter="fuzzy"
        initialQuery={initialQuery}
        searchAbove={0}
        searchPlaceholder={scope === "all" ? "Search everything" : `Search ${label.toLowerCase()}`}
        empty={`Nothing in ${label.toLowerCase()}`}
        noMatch={`No ${label.toLowerCase()} results match`}
        maxHeight="100%"
        onCollection={(next) => {
          collection.current = next;
        }}
        onPick={onPick}
        row={(item) => {
          const Icon = item.icon;
          return {
            lead: item.harness ? (
              <ProviderMark harness={item.harness} />
            ) : Icon ? (
              <Icon aria-hidden className="size-3.5" />
            ) : undefined,
            label: item.label,
            sub: item.sub,
            lines: 2,
            active: selected === item.id,
            meta: (
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="face-mono" data-tone={item.tone}>
                  {item.state}
                </span>
                <span className="inline-flex items-center gap-1 text-ink-mute">
                  <Kbd mute>Enter</Kbd>
                  {item.verb}
                </span>
              </span>
            ),
          };
        }}
        footer={
          scope === "all" ? (
            <div className="flex min-h-8 items-center justify-between gap-2 px-1 pb-1 t-small text-ink-2">
              <span>{rows.length} fixture commands</span>
              <span className="flex items-center gap-1">
                <Kbd mute>↑↓</Kbd> move <Kbd mute>Enter</Kbd> run
              </span>
            </div>
          ) : (
            <div className="pb-8">
              <Row
                role="button"
                tabIndex={0}
                lead={<ChevronsRight aria-hidden className="size-3.5" />}
                label="Search everywhere"
                aside={
                  collection.current?.query ? `Keep “${collection.current.query}”` : "All scopes"
                }
                meta="widen"
                onClick={() => onEverywhere(collection.current?.query ?? "")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onEverywhere(collection.current?.query ?? "");
                }}
              />
            </div>
          )
        }
      />
    </>
  );
}

function ThreadDetail({ id, onOutcome }: { id: string; onOutcome: (text: string) => void }) {
  const [reply, setReply] = useState("");
  if (id === "approval")
    return (
      <DetailFrame title="Retag supply diffusers" eyebrow="Approval · Tower A · Level 03">
        <p>Pea wants to set the Mark parameter on 214 supply diffusers.</p>
        <div data-surface="artifact" className="my-3 rounded-sm p-2 face-mono t-small">
          <div className="text-ink-2">host operation</div>
          <div>family.parameters.set</div>
          <div className="mt-2 text-ink-2">arguments</div>
          <div>category: OST_DuctTerminal</div>
          <div>parameter: Mark</div>
          <div>rule: SD-&#123;Level&#125;-&#123;Sequence&#125;</div>
        </div>
        <div className="flex gap-1.5">
          <Button
            kind="commit"
            icon={Check}
            label="Allow operation"
            onClick={() => onOutcome("Allowed once")}
          >
            Allow once
          </Button>
          <Button kind="framed" icon={X} label="Deny operation" onClick={() => onOutcome("Denied")}>
            Deny
          </Button>
        </div>
      </DetailFrame>
    );
  if (id === "failed")
    return (
      <DetailFrame title="Export duct schedule" eyebrow="Failed · Harbor Lab Central.rvt">
        <p data-tone="alarm">
          The central model could not be reached, so the document opened read-only.
        </p>
        <p className="mt-3 text-ink-2">
          No files were written. Reconnect the project drive before retrying.
        </p>
        <Button
          kind="framed"
          icon={RotateCcw}
          label="Retry export"
          onClick={() => onOutcome("Retry queued")}
        >
          Retry
        </Button>
      </DetailFrame>
    );
  if (id === "running")
    return (
      <DetailFrame title="Audit family parameters" eyebrow="Running · Office Fitout.rvt">
        <p>Compared 12 of 18 loaded families.</p>
        <div className="my-3 h-1 overflow-hidden rounded-sm bg-ink/10">
          <div className="h-full w-2/3 bg-current" data-tone="pea" />
        </div>
        <Button
          kind="framed"
          icon={Square}
          label="Stop audit"
          onClick={() => onOutcome("Stop requested")}
        >
          Stop
        </Button>
      </DetailFrame>
    );
  return (
    <div className="flex size-full min-h-0 flex-col">
      <DetailFrame title="Clean the sheet index" eyebrow="Finished · Lakeside Clinic.rvt">
        <div className="flex items-center gap-2 text-ink-2">
          <ProviderMark harness="codex" />
          <span>Codex · 4 minutes ago</span>
        </div>
        <p className="mt-3">
          Renumbered 31 sheets and flagged four sheets with no viewport. Nothing was deleted.
        </p>
        <ul className="my-3 list-disc space-y-1 pl-5 text-ink-2">
          <li>A101–A131 now follow the issued sequence.</li>
          <li>A118, A122, A127, and A130 need a viewport.</li>
        </ul>
      </DetailFrame>
      <form
        className="hairline-t flex shrink-0 items-center gap-1.5 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!reply.trim()) return;
          onOutcome(`Sent: ${reply.trim()}`);
          setReply("");
        }}
      >
        <MessageSquare aria-hidden className="size-4 shrink-0 text-ink-2" />
        <Input
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Reply to resume this work"
          aria-label="Reply to thread"
        />
        <Button
          kind="commit"
          icon={Send}
          label="Send reply"
          refusal={reply.trim() ? null : "Write a reply first"}
        />
      </form>
    </div>
  );
}

function ProposalDetail({ onOutcome }: { onOutcome: (text: string) => void }) {
  const [rulings, setRulings] = useState<Record<string, "accept" | "reject">>({});
  const changes = [
    ["Face velocity", "450 fpm → 500 fpm"],
    ["Neck size", "8 in → 10 in"],
    ["Shared parameter", "Add PE_Airflow_Class"],
  ];
  return (
    <DetailFrame title="HCB diffuser migration" eyebrow="Proposal · HCB-48 · Family Foundry">
      <p className="mb-3 text-ink-2">
        Review each proposed change. No change is applied until accepted.
      </p>
      <div className="hairline-t">
        {changes.map(([name, delta]) => (
          <div key={name} className="hairline-b grid grid-cols-[1fr_auto] gap-2 py-2">
            <div>
              <p className="font-semibold">{name}</p>
              <p className="face-mono t-small text-ink-2">{delta}</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                label={`Accept ${name}`}
                icon={Check}
                pressed={rulings[name] === "accept"}
                onClick={() => setRulings((value) => ({ ...value, [name]: "accept" }))}
              />
              <Button
                label={`Reject ${name}`}
                icon={X}
                pressed={rulings[name] === "reject"}
                onClick={() => setRulings((value) => ({ ...value, [name]: "reject" }))}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <Button
          kind="commit"
          label="Apply accepted changes"
          refusal={
            Object.keys(rulings).length === changes.length ? null : "Rule on every change first"
          }
          onClick={() => onOutcome("Proposal applied")}
        >
          Apply accepted
        </Button>
        <Button
          kind="framed"
          label="Open in Families"
          onClick={() => onOutcome("Opening Families")}
        >
          Open in Families
        </Button>
      </div>
    </DetailFrame>
  );
}

function DetailFrame({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="face-mono t-small t-upper text-ink-2">{eyebrow}</p>
      <h1 className="mt-1 t-title font-semibold">{title}</h1>
      <div className="mt-4 t-small">{children}</div>
    </section>
  );
}

function GenericDetail({
  scope,
  onOutcome,
}: {
  scope: "revit" | "machine";
  onOutcome: (text: string) => void;
}) {
  if (scope === "revit")
    return (
      <DetailFrame title="Revit on this machine" eyebrow="2 sessions · 3 available years">
        <p>
          Launch a year from the middle pane or inspect a running session without leaving this
          window.
        </p>
        <div className="mt-4 flex gap-1.5">
          <Button
            kind="commit"
            icon={Play}
            label="Launch Revit 2026"
            onClick={() => onOutcome("Launch queued: Revit 2026")}
          >
            Launch 2026
          </Button>
          <Button
            kind="framed"
            label="Open patch bay"
            onClick={() => onOutcome("Opening full patch bay")}
          >
            Open patch bay
          </Button>
        </div>
      </DetailFrame>
    );
  return (
    <DetailFrame title="This machine" eyebrow="Pe.Tools 0.7.24 · installed · up 11 h">
      <p>Host is ready. Two Revit sessions and both Pea providers are available.</p>
      <dl className="mt-4 grid grid-cols-[90px_1fr] gap-y-2 face-mono t-small">
        <dt className="text-ink-2">Host</dt>
        <dd>pid 42824 · :5180</dd>
        <dt className="text-ink-2">Sharing</dt>
        <dd>Private</dd>
        <dt className="text-ink-2">Account</dt>
        <dd data-tone="caution">Not signed in</dd>
      </dl>
      <div className="mt-4 flex gap-1.5">
        <Button kind="framed" label="Open full window">
          Open full window
        </Button>
        <Button label="Quit host" data-tone="alarm">
          Quit host
        </Button>
      </div>
    </DetailFrame>
  );
}

export default function Variant() {
  const [scope, setScope] = useState<Scope>("all");
  const [selected, setSelected] = useState("finished");
  const [initialQuery, setInitialQuery] = useState("");
  const [outcome, setOutcome] = useState(
    "Persistent window · fixture palette · nothing reaches the host",
  );
  const selectedItem = ITEMS.find((item) => item.id === selected) ?? ITEMS[0]!;
  const detail = useMemo(() => {
    if (selectedItem.scope === "inbox")
      return <ThreadDetail id={selectedItem.id} onOutcome={setOutcome} />;
    if (selectedItem.scope === "work") return <ProposalDetail onOutcome={setOutcome} />;
    return <GenericDetail scope={selectedItem.scope} onOutcome={setOutcome} />;
  }, [selectedItem]);
  const pickScope = (next: Scope) => {
    setScope(next);
    setInitialQuery("");
    if (next !== "all") setSelected(ITEMS.find((item) => item.scope === next)!.id);
  };
  const pickItem = (item: PaletteItem) => {
    setSelected(item.id);
    setOutcome(`${item.verb} · ${item.label}`);
  };
  return (
    <div data-surface="page" className="flex size-full flex-col overflow-hidden text-ink">
      {/* OWED: WebView2 window chrome needs a shared draggable title-bar primitive and native hit-test contract. */}
      <header className="hairline-b flex h-8 shrink-0 items-center pl-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-2"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        >
          <span className="grid size-4 place-content-center rounded-sm bg-ink text-[8px] font-bold text-on">
            Pe
          </span>
          <span className="t-small font-semibold">Pe.Tools</span>
          <span className="truncate face-mono t-small text-ink-2">{outcome}</span>
        </div>
        <div
          className="flex h-full items-center px-1"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <Button label="Pin window" icon={Pin} pressed />
          <Button label="Minimize" icon={Minus} onClick={() => setOutcome("Minimize requested")} />
          <Button label="Close" icon={X} onClick={() => setOutcome("Close requested")} />
        </div>
      </header>
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: "44px 300px minmax(0, 1fr)" }}
      >
        <nav
          aria-label="Palette scopes"
          className="hairline-r flex min-h-0 flex-col items-center gap-2 py-2"
        >
          {RAIL.map((item) => (
            <RailButton
              key={item.id}
              item={item}
              current={scope}
              onPick={() => pickScope(item.id)}
            />
          ))}
          <span className="mt-auto">
            <Button label="Window settings" icon={Settings} />
          </span>
        </nav>
        <aside className="hairline-r flex min-h-0 flex-col">
          <PalettePane
            scope={scope}
            selected={selected}
            initialQuery={initialQuery}
            onPick={pickItem}
            onEverywhere={(query) => {
              setInitialQuery(query);
              setScope("all");
            }}
          />
        </aside>
        <main className="min-h-0 min-w-0">{detail}</main>
      </div>
    </div>
  );
}
