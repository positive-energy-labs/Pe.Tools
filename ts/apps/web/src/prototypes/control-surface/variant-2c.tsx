/**
 * THROWAWAY protoui variant 2c — "Palette as a rail view": variant 2 plus one rail item, Palette, whose
 * mini sidebar IS the real ThreadsSidebar (every thread, filters, shelves) plus route/Revit/machine
 * rows as extra NavigationGroups. Curated rail views stay curated. Fixture-only.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
  Play,
  Search,
  Route as RouteIcon,
  RotateCcw,
  Send,
  Settings,
  Share2,
  Square,
  Wrench,
  X,
} from "lucide-react";

import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { Row, RowGroupHead } from "@pe/kit/lang/row";
import { ThreadsSidebar, ThreadSidebarActions } from "#/chat/thread-palette";
import { demoThreads } from "#/chat/thread-navigation";
import { emptyChatState } from "@pe/agent-contracts/chat-state";

import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = {
  id: "2c",
  label: "Palette as a rail view",
  width: 760,
  height: 560,
};

type Place = "palette" | "inbox" | "work" | "revit" | "machine";
type Activity = "waiting" | "finished" | "failed" | "running";
type Thread = {
  id: string;
  title: string;
  target: string;
  age: string;
  harness: "claude" | "codex";
  activity: Activity;
  unread?: boolean;
};

// OWED: the real tray needs an Inbox projection typed from HarnessThreadSummary instead of a
// second local view model. Rows use the kit; these richer review fixtures are local.
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

const PROPOSALS = [
  { id: "proposal", title: "HCB diffuser migration", target: "HCB-48 · 3 changes", age: "12m" },
  { id: "rtu", title: "Rooftop unit cleanup", target: "RTU-07 · 6 changes", age: "1h" },
];

const RAIL: { id: Place; label: string; icon: typeof Inbox; count?: number }[] = [
  { id: "palette", label: "Palette", icon: Search },
  { id: "inbox", label: "Inbox", icon: Inbox, count: 3 },
  { id: "work", label: "Work", icon: Wrench, count: 2 },
  { id: "revit", label: "Revit", icon: Laptop, count: 2 },
  { id: "machine", label: "Machine", icon: Settings, count: 1 },
];

const activityWord: Record<Activity, string> = {
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
    <Row role="button" tabIndex={0} lines={2} key={thread.id} id={thread.id} label={thread.title} sub={thread.target} meta={thread.age} active={selected === thread.id} actions={null} onClick={() => onSelect(thread.id)} onDoubleClick={() => undefined} onContextMenu={() => undefined} />
  );
  return (
    <nav data-navigation="" aria-label="Inbox threads" className="min-h-0 flex-1 overflow-y-auto">
      <section><RowGroupHead label="Needs attention" count={attention.length} />
        {attention.map(row)}
      </section>
      <section><RowGroupHead label="Running" count={running.length} />
        {running.map(row)}
      </section>
    </nav>
  );
}

const PALETTE_THREADS = demoThreads({
  ...emptyChatState(),
  id: "open",
  title: "Level 2 coordination review",
});
// Non-thread palette rows: where the global search would also take you.
const PALETTE_EXTRAS = [
  {
    group: "Routes",
    rows: [
      ["route:pea", "Pea", "open the chat route"],
      ["route:families", "Families", "Family Foundry"],
      ["route:pods", "Pods", "shared add-ins"],
    ],
  },
  {
    group: "Revit",
    rows: [
      ["revit:launch", "Launch Revit 2026", "start a session"],
      ["revit:bay", "Open patch bay", "sessions and years"],
    ],
  },
  {
    group: "Machine",
    rows: [
      ["machine:window", "Open full window", "verb"],
      ["machine:update", "Check for updates", "verb"],
      ["machine:quit", "Quit host", "verb"],
    ],
  },
] as const;

function PalettePane({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <>
      <PaneHead meta={<ThreadSidebarActions onNew={() => onSelect("new")} />}>
        Palette · {PALETTE_THREADS.length}
      </PaneHead>
      <div className="min-h-0 flex-1">
        {/* Real component, mounted as the app mounts it. OWED: ThreadsSidebar takes no trailing-groups
            slot, so route/Revit/machine rows are a second nav beneath it, outside its filter and search. */}
        <ThreadsSidebar
          threads={PALETTE_THREADS}
          currentThreadId={selected}
          providers={[]}
          onSelect={onSelect}
          onFork={() => undefined}
          onRename={() => undefined}
          onDelete={() => undefined}
          onUpdate={async () => true}
          onNewTarget={() => undefined}
        />
      </div>
      <nav
        data-navigation=""
        aria-label="Places and verbs"
        className="hairline-t max-h-[34%] shrink-0 overflow-y-auto"
      >
        {PALETTE_EXTRAS.map((section) => (
          <section key={section.group}><RowGroupHead label={section.group} count={section.rows.length} />
            {section.rows.map(([id, title, target]) => (
              <Row role="button" tabIndex={0} lines={2} key={id} id={id} label={title} sub={target} meta={null} active={selected === id} actions={null} onClick={() => onSelect(id)} onDoubleClick={() => undefined} onContextMenu={() => undefined} />
            ))}
          </section>
        ))}
      </nav>
    </>
  );
}

function PaletteDetail({ id, onOutcome }: { id: string; onOutcome: (text: string) => void }) {
  const thread = PALETTE_THREADS.find((item) => item.id === id);
  if (thread)
    return (
      <DetailFrame
        title={thread.title}
        eyebrow={`Thread · ${thread.activity.state} · ${thread.providerName}`}
      >
        <div className="flex items-center gap-2 text-ink-2">
          <ProviderMark harness={thread.harness} />
          <span>
            {thread.providerName} · {thread.modelId}
          </span>
        </div>
        <p className="mt-3 text-ink-2">
          Preview of the highlighted palette row. The same row opens in /pea.
        </p>
        <div className="mt-4 flex gap-1.5">
          <Button
            kind="commit"
            icon={MessageSquare}
            label="Open thread"
            onClick={() => onOutcome(`Open ${thread.title} in /pea`)}
          >
            Open in Pea
          </Button>
        </div>
      </DetailFrame>
    );
  const extra = PALETTE_EXTRAS.flatMap((section) =>
    section.rows.map((row) => ({ section: section.group, row })),
  ).find((item) => item.row[0] === id);
  return (
    <DetailFrame
      title={extra?.row[1] ?? "Palette"}
      eyebrow={extra ? `${extra.section} · ${extra.row[2]}` : "Palette"}
    >
      <p className="text-ink-2">
        {extra
          ? "Not a thread: the palette also reaches routes, Revit and machine verbs."
          : "Pick a row to preview it here."}
      </p>
      {extra ? (
        <div className="mt-4">
          <Button
            kind="commit"
            icon={RouteIcon}
            label={`Go: ${extra.row[1]}`}
            onClick={() => onOutcome(`Go: ${extra.row[1]}`)}
          >
            Go
          </Button>
        </div>
      ) : null}
    </DetailFrame>
  );
}

function MiddlePane({
  place,
  selected,
  onSelect,
}: {
  place: Place;
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (place === "palette") return <PalettePane selected={selected} onSelect={onSelect} />;
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
            lead={<span className="size-2 rounded-full bg-current" data-tone="done" />}
            label="2025 · dev"
            aside="Lakeside Clinic.rvt · controlled"
            meta="ready"
          />
          <Row
            lead={<span className="size-2 rounded-full bg-current" data-tone="done" />}
            label="2024 · installed"
            aside="Tower A.rvt · observed"
            meta="ready"
          />
          <p className="hairline-t mt-2 px-2.5 pt-2 t-small t-upper text-ink-2">Launch</p>
          {[2024, 2025, 2026].map((year) => (
            <Row
              key={year}
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
          lead={<Download aria-hidden className="size-3.5" />}
          label="Update"
          aside="0.7.24 · up to date"
        />
        <Row
          lead={<Share2 aria-hidden className="size-3.5" />}
          label="Share"
          aside="This machine is private"
        />
        <Row
          lead={<Cloud aria-hidden className="size-3.5" />}
          label="Providers"
          aside="Claude · Codex"
        />
        <Row
          lead={<Bell aria-hidden className="size-3.5" />}
          label="Account"
          aside="Not signed in"
          meta="cloud auth"
        />
      </div>
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
  place,
  onOutcome,
}: {
  place: "revit" | "machine";
  onOutcome: (text: string) => void;
}) {
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

export default function Variant() {
  const [place, setPlace] = useState<Place>("palette");
  const [selected, setSelected] = useState("open");
  const [outcome, setOutcome] = useState("Persistent window · does not dismiss on unfocus");
  const detail = useMemo(() => {
    if (place === "palette") return <PaletteDetail id={selected} onOutcome={setOutcome} />;
    if (place === "inbox") return <ThreadDetail id={selected} onOutcome={setOutcome} />;
    if (place === "work") return <ProposalDetail onOutcome={setOutcome} />;
    return <GenericDetail place={place} onOutcome={setOutcome} />;
  }, [place, selected]);
  const pickPlace = (next: Place) => {
    setPlace(next);
    setSelected(
      next === "palette"
        ? "open"
        : next === "inbox"
          ? "finished"
          : next === "work"
            ? "proposal"
            : next,
    );
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
    </div>
  );
}
