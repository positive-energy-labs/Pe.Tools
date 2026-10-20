/**
 * THROWAWAY protoui variant 2b — "Palette over the window": variant 2's three columns stay curated;
 * the app command palette (List, the body of CommandPalette) is summoned over the whole window
 * with Ctrl+K or the title-bar field, holds everything, and lands the pick in rail + roster + detail.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bell,
  Check,
  Cloud,
  Download,
  Inbox,
  Laptop,
  MessageSquare,
  Minus,
  Pin,
  Search,
  FolderOpen,
  Power,
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

import { Button } from "#/components/lang/button";
import { Input } from "#/components/lang/input";
import { Kbd } from "#/components/lang/kbd";
import { List } from "#/components/lang/list-popup";
import { NavigationGroup, NavigationItem } from "#/components/lang/navigation";
import { ProviderMark } from "#/components/lang/provider-mark";
import { Row } from "#/components/lang/row";

import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = {
  id: "2b",
  label: "Palette over the window",
  width: 760,
  height: 560,
};

export type Place = "inbox" | "work" | "revit" | "machine";
export type Activity = "waiting" | "finished" | "failed" | "running";
export type Thread = {
  id: string;
  title: string;
  target: string;
  age: string;
  harness: "claude" | "codex";
  activity: Activity;
  unread?: boolean;
};

// OWED: the real tray needs an Inbox projection typed from HarnessThreadSummary instead of a
// second local view model. NavigationItem is real; only these richer review fixtures are local.
export const THREADS: Thread[] = [
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

export const PROPOSALS = [
  { id: "proposal", title: "HCB diffuser migration", target: "HCB-48 · 3 changes", age: "12m" },
  { id: "rtu", title: "Rooftop unit cleanup", target: "RTU-07 · 6 changes", age: "1h" },
];

const RAIL: { id: Place; label: string; icon: typeof Inbox; count?: number }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox, count: 3 },
  { id: "work", label: "Work", icon: Wrench, count: 2 },
  { id: "revit", label: "Revit", icon: Laptop, count: 2 },
  { id: "machine", label: "Machine", icon: Settings, count: 1 },
];

export const activityWord: Record<Activity, string> = {
  waiting: "Waiting",
  finished: "Finished",
  failed: "Failed",
  running: "Running",
};

function RailButton({
  place,
  current,
  onPick,
}: {
  place: (typeof RAIL)[number];
  current: Place;
  onPick: () => void;
}) {
  const Icon = place.icon;
  return (
    <span className="relative flex justify-center">
      <Button label={place.label} icon={Icon} pressed={current === place.id} onClick={onPick} />
      {place.count ? (
        <span
          className="pointer-events-none absolute right-0 top-0 grid min-w-3 place-content-center rounded-full px-0.5 face-mono text-[9px] leading-3"
          data-tone={place.id === "machine" ? "caution" : undefined}
          aria-label={`${place.count} ${place.label}`}
        >
          {place.count}
        </span>
      ) : null}
    </span>
  );
}

function PaneHead({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="hairline-b flex h-9 shrink-0 items-center gap-2 px-2.5">
      <h2 className="min-w-0 flex-1 truncate t-small font-semibold">{children}</h2>
      {meta ? <span className="face-mono t-small text-ink-2">{meta}</span> : null}
    </div>
  );
}

function ThreadRoster({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const attention = THREADS.filter((thread) => thread.activity !== "running");
  const running = THREADS.filter((thread) => thread.activity === "running");
  const row = (thread: Thread) => (
    <NavigationItem
      key={thread.id}
      id={thread.id}
      title={thread.title}
      target={thread.target}
      time={thread.age}
      mark={<ProviderMark harness={thread.harness} />}
      meta={`${thread.harness} · fixture`}
      state={activityWord[thread.activity]}
      stateTone={
        thread.activity === "failed"
          ? "alarm"
          : thread.activity === "waiting"
            ? "caution"
            : undefined
      }
      activity={thread.activity === "finished" ? undefined : thread.activity}
      unread={thread.unread}
      active={selected === thread.id}
      compact={thread.activity === "finished"}
      actions={null}
      onPick={() => onSelect(thread.id)}
      onRename={() => undefined}
      onMenu={() => undefined}
      onDrop={() => undefined}
    />
  );
  return (
    <nav data-navigation="" aria-label="Inbox threads" className="min-h-0 flex-1 overflow-y-auto">
      <NavigationGroup label="Needs attention" count={attention.length} stack={{ index: 0, of: 2 }}>
        {attention.map(row)}
      </NavigationGroup>
      <NavigationGroup label="Running" count={running.length} stack={{ index: 1, of: 2 }}>
        {running.map(row)}
      </NavigationGroup>
    </nav>
  );
}

export function MiddlePane({
  place,
  selected,
  onSelect,
}: {
  place: Place;
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (place === "inbox")
    return (
      <>
        <PaneHead meta="3 unread">Inbox</PaneHead>
        <ThreadRoster selected={selected} onSelect={onSelect} />
      </>
    );
  if (place === "work")
    return (
      <>
        <PaneHead meta="2 open">Work</PaneHead>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {PROPOSALS.map((proposal) => (
            <Row
              key={proposal.id}
              role="button"
              tabIndex={0}
              active={selected === proposal.id}
              lead={<Wrench aria-hidden className="size-3.5" />}
              label={proposal.title}
              aside={proposal.target}
              meta={proposal.age}
              onClick={() => onSelect(proposal.id)}
            />
          ))}
        </div>
      </>
    );
  if (place === "revit")
    return (
      <>
        <PaneHead meta="2 running">Revit</PaneHead>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-2.5 pt-2 t-small t-upper text-ink-2">Sessions</p>
          <Row
            role="button"
            tabIndex={0}
            active={selected === "session-2025"}
            onClick={() => onSelect("session-2025")}
            lead={<span className="size-2 rounded-full bg-current" data-tone="done" />}
            label="2025 · dev"
            aside="Lakeside Clinic.rvt · controlled"
            meta="ready"
          />
          <Row
            role="button"
            tabIndex={0}
            active={selected === "session-2024"}
            onClick={() => onSelect("session-2024")}
            lead={<span className="size-2 rounded-full bg-current" data-tone="done" />}
            label="2024 · installed"
            aside="Tower A.rvt · observed"
            meta="ready"
          />
          <p className="hairline-t mt-2 px-2.5 pt-2 t-small t-upper text-ink-2">Launch</p>
          {[2024, 2025, 2026].map((year) => (
            <Row
              key={year}
              role="button"
              tabIndex={0}
              active={selected === `launch-${year}`}
              onClick={() => onSelect(`launch-${year}`)}
              lead={<Play aria-hidden className="size-3.5" />}
              label={`Revit ${year}`}
              aside="Start a new session"
              meta="launch"
            />
          ))}
        </div>
      </>
    );
  return (
    <>
      <PaneHead meta="installed">Machine</PaneHead>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Row
          role="button"
          tabIndex={0}
          active={selected === "m-update"}
          onClick={() => onSelect("m-update")}
          lead={<Download aria-hidden className="size-3.5" />}
          label="Update"
          aside="0.7.24 · up to date"
        />
        <Row
          role="button"
          tabIndex={0}
          active={selected === "m-share"}
          onClick={() => onSelect("m-share")}
          lead={<Share2 aria-hidden className="size-3.5" />}
          label="Share"
          aside="This machine is private"
        />
        <Row
          role="button"
          tabIndex={0}
          active={selected === "m-providers"}
          onClick={() => onSelect("m-providers")}
          lead={<Cloud aria-hidden className="size-3.5" />}
          label="Providers"
          aside="Claude · Codex"
        />
        <Row
          role="button"
          tabIndex={0}
          active={selected === "m-account"}
          onClick={() => onSelect("m-account")}
          lead={<Bell aria-hidden className="size-3.5" />}
          label="Account"
          aside="Not signed in"
          meta="cloud auth"
        />
      </div>
    </>
  );
}

export function ThreadDetail({ id, onOutcome }: { id: string; onOutcome: (text: string) => void }) {
  const [reply, setReply] = useState("");
  if (id === "approval")
    return (
      <DetailFrame title="Retag supply diffusers" eyebrow="Approval · Tower A · Level 03">
        <p>Pea wants to set the Mark parameter on 214 supply diffusers.</p>
        <div data-surface="artifact" className="my-3 rounded p-2 face-mono t-small">
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
        <div className="my-3 h-1 overflow-hidden rounded bg-ink/10">
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

export function ProposalDetail({ onOutcome }: { onOutcome: (text: string) => void }) {
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

export function DetailFrame({
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
      <h1 className="mt-1 text-lg font-semibold">{title}</h1>
      <div className="mt-4 t-small leading-relaxed">{children}</div>
    </section>
  );
}

export function GenericDetail({
  place,
  selected,
  onOutcome,
}: {
  place: "revit" | "machine";
  selected: string;
  onOutcome: (text: string) => void;
}) {
  const focus = FOCUS[selected];
  if (focus)
    return (
      <DetailFrame title={focus[0]} eyebrow={focus[1]}>
        <p>{focus[2]}</p>
        <div className="mt-4">
          <Button kind="framed" label={focus[3]} onClick={() => onOutcome(focus[3])}>
            {focus[3]}
          </Button>
        </div>
      </DetailFrame>
    );
  if (place === "revit")
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

export const FOCUS: Record<string, [title: string, eyebrow: string, body: string, verb: string]> = {
  "session-2025": [
    "Revit 2025 · dev",
    "Session · controlled",
    "Lakeside Clinic.rvt is open. This session is held by pe-revit.",
    "Show documents",
  ],
  "session-2024": [
    "Revit 2024 · installed",
    "Session · observed",
    "Tower A.rvt is open. Reads only until a targeted mutation adopts it.",
    "Show documents",
  ],
  "launch-2024": [
    "Launch Revit 2024",
    "Launch",
    "Start a new session on the installed payload.",
    "Launch 2024",
  ],
  "launch-2025": [
    "Launch Revit 2025",
    "Launch",
    "Start a new session on the dev payload.",
    "Launch 2025",
  ],
  "launch-2026": ["Launch Revit 2026", "Launch", "Start a new session.", "Launch 2026"],
  "m-update": ["Update", "Machine", "Pe.Tools 0.7.24 is current.", "Check for updates"],
  "m-share": ["Share", "Machine", "This machine is private.", "Share this machine"],
  "m-providers": ["Providers", "Machine", "Claude and Codex are ready.", "Test providers"],
  "m-account": ["Account", "Machine · cloud auth", "Not signed in.", "Sign in"],
};

// ---- The palette: one catalogue, summoned over the window -------------------------------------

export type Kind = "Needs you" | "Work" | "Revit" | "Machine" | "App";
export type Hit = {
  key: string;
  kind: Kind;
  label: string;
  aside: string;
  state: string;
  icon: LucideIcon;
  /** Where choosing it lands in the rail + roster + detail; absent = an app route (fake). */
  lands?: { place: Place; selected: string };
  verb: string;
};

const HITS: readonly Hit[] = [
  ...THREADS.map(
    (t): Hit => ({
      key: `t-${t.id}`,
      kind: t.activity === "running" ? "Work" : "Needs you",
      label: t.title,
      aside: `${t.harness} · ${t.target}`,
      state: activityWord[t.activity],
      icon: MessageSquare,
      lands: { place: "inbox", selected: t.id },
      verb: "Open thread",
    }),
  ),
  ...PROPOSALS.map(
    (p): Hit => ({
      key: `p-${p.id}`,
      kind: "Work",
      label: p.title,
      aside: p.target,
      state: "Proposal",
      icon: Wrench,
      lands: { place: "work", selected: p.id },
      verb: "Review proposal",
    }),
  ),
  {
    key: "s-2025",
    kind: "Revit",
    label: "Revit 2025 · dev",
    aside: "Lakeside Clinic.rvt",
    state: "controlled",
    icon: Laptop,
    lands: { place: "revit", selected: "session-2025" },
    verb: "Show session",
  },
  {
    key: "s-2024",
    kind: "Revit",
    label: "Revit 2024 · installed",
    aside: "Tower A.rvt",
    state: "observed",
    icon: Laptop,
    lands: { place: "revit", selected: "session-2024" },
    verb: "Show session",
  },
  ...[2024, 2025, 2026].map(
    (y): Hit => ({
      key: `l-${y}`,
      kind: "Revit",
      label: `Launch Revit ${y}`,
      aside: "Start a new session",
      state: "ready",
      icon: Play,
      lands: { place: "revit", selected: `launch-${y}` },
      verb: "Select",
    }),
  ),
  {
    key: "m-update",
    kind: "Machine",
    label: "Update",
    aside: "0.7.24 · up to date",
    state: "current",
    icon: Download,
    lands: { place: "machine", selected: "m-update" },
    verb: "Select",
  },
  {
    key: "m-share",
    kind: "Machine",
    label: "Share this machine",
    aside: "Private",
    state: "refused",
    icon: Share2,
    lands: { place: "machine", selected: "m-share" },
    verb: "Select",
  },
  {
    key: "m-providers",
    kind: "Machine",
    label: "Providers",
    aside: "Claude · Codex",
    state: "2 of 2",
    icon: Cloud,
    lands: { place: "machine", selected: "m-providers" },
    verb: "Select",
  },
  {
    key: "m-account",
    kind: "Machine",
    label: "Sign in to cloud",
    aside: "Account",
    state: "signed out",
    icon: Bell,
    lands: { place: "machine", selected: "m-account" },
    verb: "Select",
  },
  {
    key: "m-quit",
    kind: "Machine",
    label: "Quit host",
    aside: "pid 42824",
    state: "running",
    icon: Power,
    verb: "Quit",
  },
  {
    key: "a-families",
    kind: "App",
    label: "Open Families",
    aside: "Route /families",
    state: "route",
    icon: FolderOpen,
    verb: "Open",
  },
  {
    key: "a-pea",
    kind: "App",
    label: "Open Pea",
    aside: "Route /pea",
    state: "route",
    icon: FolderOpen,
    verb: "Open",
  },
  {
    key: "a-machine",
    kind: "App",
    label: "Open full window",
    aside: "Route /machine",
    state: "route",
    icon: FolderOpen,
    verb: "Open",
  },
];

/** The same List body CommandPalette wraps, mounted inside the tray window instead of a viewport Dialog. */
// OWED: CommandPalette needs presentation="inline" (or a `container` prop) so the Dialog/Popover can
// portal into a window-sized layer instead of the browser viewport; its onPick/onEscape wrapper is repeated below.
function WindowPalette({ onClose, onPick }: { onClose: () => void; onPick: (hit: Hit) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    frame.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
  }, []);
  return (
    <div
      className="absolute inset-0 z-10 grid items-start justify-items-center bg-ink/40 p-6 pt-10"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={frame}
        data-surface="page"
        className="float-surface w-full max-w-[520px] overflow-hidden p-1"
      >
        <List<Hit>
          aria-label="Find anything in Pe.Tools"
          items={HITS}
          keyOf={(hit) => hit.key}
          labelOf={(hit) => `${hit.label} ${hit.aside} ${hit.state} ${hit.kind}`}
          groupOf={(hit) => hit.kind}
          filter="fuzzy"
          searchAbove={0}
          searchPlaceholder="Search threads, Work, Revit, machine and tools"
          empty="Nothing to find"
          noMatch="No matching thread, Work, Revit or tool"
          maxHeight="min(24rem, 60dvh)"
          onPick={(hit) => {
            onPick(hit);
            onClose();
          }}
          onEscape={onClose}
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
            <div className="flex items-center justify-end gap-1.5 px-1 pb-1 t-small text-ink-2">
              <Kbd>↑↓</Kbd> move <Kbd hotkey="Enter" /> choose <Kbd hotkey="Escape" /> close
            </div>
          }
        />
      </div>
    </div>
  );
}

export default function Variant() {
  const [place, setPlace] = useState<Place>("inbox");
  const [selected, setSelected] = useState("finished");
  const [open, setOpen] = useState(true);
  const [outcome, setOutcome] = useState("Find anything");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const detail = useMemo(() => {
    if (place === "inbox") return <ThreadDetail id={selected} onOutcome={setOutcome} />;
    if (place === "work") return <ProposalDetail onOutcome={setOutcome} />;
    return <GenericDetail place={place} selected={selected} onOutcome={setOutcome} />;
  }, [place, selected]);
  const pickPlace = (next: Place) => {
    setPlace(next);
    setSelected(next === "inbox" ? "finished" : next === "work" ? "proposal" : next);
  };
  const land = (hit: Hit) => {
    if (hit.lands) {
      setPlace(hit.lands.place);
      setSelected(hit.lands.selected);
      setOutcome(`${hit.verb} · ${hit.label}`);
    } else setOutcome(`${hit.verb} · ${hit.label} (fixture)`);
  };
  return (
    <div
      data-surface="page"
      className="relative flex size-full flex-col overflow-hidden bg-surface text-ink"
    >
      {/* OWED: WebView2 window chrome needs a shared draggable title-bar primitive and native hit-test contract. */}
      <header className="hairline-b flex h-8 shrink-0 items-center pl-3">
        <div
          className="flex min-w-0 items-center gap-2"
          style={{ WebkitAppRegion: "drag" } as CSSProperties}
        >
          <span className="grid size-4 place-content-center rounded-sm bg-ink text-[8px] font-bold text-surface">
            Pe
          </span>
          <span className="t-small font-semibold">Pe.Tools</span>
        </div>
        <div
          className="flex min-w-0 flex-1 justify-center px-2"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <button
            type="button"
            aria-label="Find anything"
            onClick={() => setOpen(true)}
            className="hairline flex h-6 w-72 max-w-full cursor-pointer items-center gap-1.5 rounded px-2 t-small text-ink-2 hover:text-ink"
          >
            <Search aria-hidden className="size-3.5" />
            <span className="min-w-0 flex-1 truncate text-left">{outcome}</span>
            <Kbd mute>Ctrl K</Kbd>
          </button>
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
        style={{ gridTemplateColumns: "44px 260px minmax(0, 1fr)" }}
      >
        <nav
          aria-label="Control surface"
          className="hairline-r flex min-h-0 flex-col items-center gap-2 py-2"
        >
          {RAIL.map((item) => (
            <RailButton
              key={item.id}
              place={item}
              current={place}
              onPick={() => pickPlace(item.id)}
            />
          ))}
          <span className="mt-auto">
            <Button label="Window settings" icon={Settings} />
          </span>
        </nav>
        <aside className="hairline-r flex min-h-0 flex-col">
          <MiddlePane place={place} selected={selected} onSelect={setSelected} />
        </aside>
        <main className="min-h-0 min-w-0">{detail}</main>
      </div>
      {open ? <WindowPalette onClose={() => setOpen(false)} onPick={land} /> : null}
    </div>
  );
}
