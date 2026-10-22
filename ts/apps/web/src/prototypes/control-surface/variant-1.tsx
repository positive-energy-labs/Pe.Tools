import { TooltipHint } from "@pe/kit/lang/tooltip";
/** THROWAWAY protoui variant 1 — "Inbox first": the tray is an inbox before it is a status panel. */
import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronUp,
  CircleCheck,
  FileDiff,
  Hand,
  MessageSquareText,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import type { Machine } from "@pe/agent-contracts";

import { Button } from "@pe/kit/lang/button";
import { ProviderMark } from "#/components/lang/provider-mark";
import { Row } from "@pe/kit/lang/row";
import { MACHINE_SEEDS } from "#/open/seeds";
import { attention, peaState, revitState, shareState } from "#/machine/model";

import { updateSaid } from "#/machine/update-state";

import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = { id: "1", label: "Inbox first", width: 420, height: 640 };

type Kind = "approve" | "finished" | "failed";
interface Item {
  id: string;
  kind: Kind;
  title: string;
  target: string;
  harness: "claude" | "codex";
  age: string;
  excerpt?: string;
  ask?: string;
  read?: boolean;
}

// OWED: fixture typed loosely; the real inbox row would project HarnessThreadSummary.
const ITEMS: Item[] = [
  {
    id: "t1",
    kind: "approve",
    title: "Retag supply diffusers",
    target: "project-a Tower.rvt",
    harness: "claude",
    age: "2m",
    ask: "Run script: set Mark on 214 Air Terminals",
  },
  {
    id: "t2",
    kind: "approve",
    title: "Which level for the riser?",
    target: "Riverside MEP.rvt",
    harness: "codex",
    age: "9m",
    ask: "Level 3 or Level 4 for the new riser?",
  },
  {
    id: "t3",
    kind: "finished",
    title: "Sheet index cleanup",
    target: "Clinic Renovation.rvt",
    harness: "claude",
    age: "34m",
    excerpt: "Renumbered 31 sheets and flagged 4 with no viewport; nothing was deleted.",
  },
  {
    id: "t4",
    kind: "failed",
    title: "Export duct schedule",
    target: "Harbor Lab Central.rvt",
    harness: "codex",
    age: "1h",
    excerpt: "Model is read-only: central file not reachable.",
  },
  {
    id: "t5",
    kind: "finished",
    title: "Family parameter audit",
    target: "Office Fitout.rvt",
    harness: "claude",
    age: "3h",
    excerpt: "All 18 families carry the shared parameter set.",
    read: true,
  },
  {
    id: "t6",
    kind: "finished",
    title: "Rename views by template",
    target: "project-a Shell.rvt",
    harness: "codex",
    age: "1d",
    excerpt: "Applied the naming rule to 52 views.",
    read: true,
  },
];

const PROPOSALS = [
  { id: "p1", ref: "HCB-48", what: "22 changes", target: "Families · HCB Diffuser" },
  { id: "p2", ref: "RTU-07", what: "6 changes", target: "Families · Rooftop Unit" },
];

const lamp = (tone?: "caution" | "alarm" | "done") =>
  tone === "alarm"
    ? "bg-[var(--pe-alarm,#e5484d)]"
    : tone === "caution"
      ? "bg-[var(--pe-caution,#e5a13a)]"
      : "bg-[var(--pe-done,#3fb27f)]";

function Lead({ kind }: { kind: Kind }) {
  const I = kind === "approve" ? Hand : kind === "failed" ? TriangleAlert : CircleCheck;
  return (
    <I
      aria-hidden
      className="size-3.5"
      data-tone={kind === "failed" ? "alarm" : kind === "approve" ? "caution" : undefined}
    />
  );
}

function Verbs({ children }: { children: ReactNode }) {
  return <span className="mt-1 flex items-center gap-1.5">{children}</span>;
}

export default function Variant() {
  const machine = (MACHINE_SEEDS["patch-bay"] as unknown as { observation: Machine }).observation;
  const [read, setRead] = useState<Set<string>>(
    () => new Set(ITEMS.filter((i) => i.read).map((i) => i.id)),
  );
  const [sheet, setSheet] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const mark = (id: string, words: string) => {
    setRead((s) => new Set(s).add(id));
    setSaid(words);
  };
  const waiting = ITEMS.filter((i) => i.kind === "approve" && !read.has(i.id)).length;
  const fresh = ITEMS.filter((i) => !read.has(i.id));
  const cleared = ITEMS.filter((i) => read.has(i.id));
  const head =
    [
      waiting ? `${waiting} thread${waiting > 1 ? "s" : ""} wait on you` : null,
      `${PROPOSALS.length} proposal${PROPOSALS.length > 1 ? "s" : ""} to review`,
    ]
      .filter(Boolean)
      .join(" · ") || "Nothing waits on you.";

  const lamps = [
    { key: "Revit", said: revitState(machine) },
    { key: "Update", said: updateSaid(machine) },
    { key: "Share", said: shareState(machine) },
    { key: "Pea", said: peaState(machine) },
  ];

  const row = (item: Item) => {
    const isRead = read.has(item.id);
    return (
      <div
        key={item.id}
        className={isRead ? "opacity-50 transition-opacity" : undefined}
        data-navigation-item=""
      >
        <Row
          lines={2}
          lead={<Lead kind={item.kind} />}
          label={item.title}
          meta={
            <span className="flex items-center gap-1.5 face-mono t-small text-ink-2">
              {item.age}
              {!isRead ? (
                <span className="size-1.5 rounded-full bg-current" aria-label="unread" />
              ) : null}
            </span>
          }
          sub={
            <span className="block min-w-0">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="min-w-0 flex-1 truncate">
                  {item.kind === "approve" ? item.ask : `${item.target} — ${item.excerpt}`}
                </span>
                <ProviderMark harness={item.harness} />
              </span>
              {!isRead ? (
                <Verbs>
                  {item.kind === "approve" ? (
                    <>
                      <Button
                        kind="commit"
                        label="Approve"
                        icon={Check}
                        onClick={() => mark(item.id, `approved ${item.title}`)}
                      >
                        {item.ask?.endsWith("?") ? "Answer" : "Approve"}
                      </Button>
                      <Button
                        kind="framed"
                        label="Open thread"
                        onClick={() => setSaid("open " + item.title)}
                      >
                        Open
                      </Button>
                    </>
                  ) : item.kind === "finished" ? (
                    <Button
                      kind="framed"
                      label="Resume"
                      icon={Play}
                      onClick={() => mark(item.id, `resumed ${item.title}`)}
                    >
                      Resume
                    </Button>
                  ) : (
                    <>
                      <Button
                        kind="framed"
                        label="Retry"
                        icon={RotateCcw}
                        onClick={() => mark(item.id, `retry ${item.title}`)}
                      >
                        Retry
                      </Button>
                      <Button
                        label="Open thread"
                        onClick={() => mark(item.id, "open " + item.title)}
                      >
                        Open
                      </Button>
                    </>
                  )}
                </Verbs>
              ) : null}
            </span>
          }
        />
      </div>
    );
  };

  return (
    <div
      data-surface="page"
      className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--pe-on,inherit)] text-ink"
    >
      <header className="hairline-b px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <MessageSquareText aria-hidden className="size-4 text-ink-2" />
          <h1 className="t-prose flex-1 font-semibold">{head}</h1>
        </div>
        <p className="mt-0.5 face-mono t-small text-ink-2">
          {said ?? "Inbox · only threads that ask or finished"}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="hairline-b px-3 py-1.5 face-mono t-small t-upper text-ink-2">
          Inbox · {fresh.length}
        </div>
        {fresh.map(row)}
        {cleared.length ? (
          <>
            <div className="flex items-center gap-2 px-3 py-1.5 face-mono t-small t-upper text-ink-2">
              <span>Cleared · {cleared.length}</span>
              <span className="hairline-t flex-1" aria-hidden />
            </div>
            {cleared.map(row)}
          </>
        ) : null}

        <div className="hairline-t mt-1 px-3 py-1.5 face-mono t-small t-upper text-ink-2">
          Work · proposals
        </div>
        {PROPOSALS.map((p) => (
          <Row
            key={p.id}
            lines={2}
            lead={<FileDiff aria-hidden className="size-3.5" />}
            label={`${p.ref} · ${p.what}`}
            meta={<span className="face-mono t-small text-ink-2">proposal</span>}
            sub={
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="min-w-0 flex-1 truncate">{p.target}</span>
                <Button kind="framed" label="Review" onClick={() => setSaid(`review ${p.ref}`)}>
                  Review
                </Button>
              </span>
            }
          />
        ))}
      </div>

      {sheet ? (
        <div
          className="hairline-t absolute inset-x-0 bottom-9 top-14 z-10 overflow-y-auto bg-[var(--pe-on,#111)] p-3"
          role="dialog"
          aria-label="machine status"
        >
          <p className="mb-2 face-mono t-small t-upper text-ink-2">
            Machine · {attention(machine).join(" · ") || "nothing waits"}
          </p>
          {lamps.map((l) => (
            <div key={l.key} className="hairline-b flex items-center gap-2 py-1.5">
              <span className={`size-2 rounded-full ${lamp(l.said.tone)}`} />
              <span className="w-14 font-semibold">{l.key}</span>
              <span className="face-mono t-small text-ink-2">{l.said.text}</span>
            </div>
          ))}
          {/* OWED: sheet body is the machine groups (PatchBay/UpdateGroup/ShareGroup/PeaGroup) in a compact projection; not mounted in this throwaway. */}
          <p className="mt-3 face-mono t-small text-ink-2">
            Pe.Tools {machine.host?.version} · pid {machine.host?.process.pid} · :
            {machine.host?.port}
          </p>
          <div className="mt-2 flex gap-2">
            <Button kind="framed" label="Open window">
              Open window
            </Button>
            <Button label="Quit host" data-tone="alarm">
              Quit host
            </Button>
          </div>
        </div>
      ) : null}

      <footer className="hairline-t z-20 flex h-9 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={sheet}
          onClick={() => setSheet((s) => !s)}
        >
          {lamps.map((l) => (
            <TooltipHint key={l.key} content={`${l.key}: ${l.said.text}`}>
              <span className="flex items-center gap-1 face-mono t-small text-ink-2">
                <span className={`size-1.5 rounded-full ${lamp(l.said.tone)}`} />
                {l.key === "Revit"
                  ? l.said.text.split(" · ")[0]
                  : l.key === "Update"
                    ? l.said.tone
                      ? "update"
                      : "current"
                    : l.key === "Share"
                      ? l.said.tone
                        ? "share !"
                        : "share"
                      : l.said.text.split(" ")[0] + " pea"}
              </span>
            </TooltipHint>
          ))}
          <ChevronUp
            aria-hidden
            className={`ml-auto size-3.5 text-ink-2 ${sheet ? "rotate-180" : ""}`}
          />
        </button>
        <span className="flex shrink-0 items-center">
          <Button
            kind="framed"
            label="Launch Revit 2025"
            onClick={() => setSaid("launch Revit 2025")}
          >
            + Revit 2025
          </Button>
          <Button
            kind="framed"
            label="Pick a Revit year"
            onClick={() => setSaid("pick year: 2024 · 2025 · 2026")}
          >
            ▾
          </Button>
        </span>
      </footer>
    </div>
  );
}
