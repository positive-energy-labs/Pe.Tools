/** THROWAWAY: round 1, small Pea replaces the tray. Every action changes fixtures only. */
import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ArrowUp, GripHorizontal, Minus, Pin, Plus, X } from "lucide-react";
import type { HarnessThreadSummary } from "@pe/agent-contracts";
import { Accordion } from "#/components/lang/accordion";
import { Button } from "@pe/kit/lang/button";
import {
  Composer,
  ComposerFrame,
  ConversationBody,
  MessageBubble,
  MessageHead,
} from "#/components/lang/conversation";
import { PopupFrame } from "@pe/kit/lang/list-popup";
import { ValueDiff } from "#/components/lang/value-diff";
import { Markdown } from "#/workbench/prose";
import { BAY_THREADS } from "#/open/seeds";
import { activityWord } from "#/chat/thread-navigation";
import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = {
  id: "6",
  label: "Tray is Pea (overreach)",
  width: 440,
  height: 760,
};

type Ticket = {
  thread: HarnessThreadSummary;
  message: string;
  kind: "proposal" | "approval" | "finished" | "failed";
  reply?: string;
  decision?: string;
};
const tickets: Ticket[] = [
  {
    thread: {
      ...BAY_THREADS[2]!,
      title: "HCB family · connector repair",
      activity: { state: "waiting", pending: 1, lastSeq: 120, message: null },
    },
    kind: "proposal",
    message:
      "The return connector was pointing into the casing. I prepared **3 changes** for `HCB-450.rfa`. Review them here before I touch the family.",
  },
  {
    thread: {
      ...BAY_THREADS[1]!,
      title: "Level 2 · write permission",
      activity: { state: "waiting", pending: 1, lastSeq: 88, message: null },
    },
    kind: "approval",
    message:
      "I found **12 untagged diffusers** in Level 2. May I add the tags to `Hospital MEP.rvt`? This changes the active document.",
  },
  {
    thread: { ...BAY_THREADS[0]!, title: "Retag level 1 diffusers" },
    kind: "finished",
    message:
      "All **12 diffuser tags** are in place. I checked for duplicates and found none.\n\nReceipt: `r-0912` · Level 1 mechanical plan.",
  },
  {
    thread: {
      ...BAY_THREADS[0]!,
      id: "t-export-failed",
      title: "Export equipment schedule",
      activity: { state: "failed", pending: 0, lastSeq: 9, message: null },
    },
    kind: "failed",
    message:
      "The destination folder is read-only. **No file was written.** Send me a different folder and I can try again.",
  },
];

function MachineChip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button label={label} kind="framed">
            {label}
          </Button>
        }
      />
      <PopupFrame label={label}>
        <div className="flex w-64 flex-col gap-3 p-3">{children}</div>
      </PopupFrame>
    </Popover.Root>
  );
}

export default function Variant() {
  const [items, setItems] = useState(tickets);
  const [expanded, setExpanded] = useState<string[]>([
    tickets[0]!.thread.id,
    tickets[2]!.thread.id,
  ]);
  const [focused, setFocused] = useState<string | null>(tickets[0]!.thread.id);
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState(true);
  const [windowState, setWindowState] = useState<"open" | "minimized" | "closed">("open");
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [launched, setLaunched] = useState<number[]>([2025]);
  const [update, setUpdate] = useState("Up to date · checked just now");
  const [sharing, setSharing] = useState(false);
  const [provider, setProvider] = useState("Claude");
  const [notice, setNotice] = useState("");
  const current = items.find((item) => item.thread.id === focused);
  const waiting = items.filter((item) => item.thread.activity.pending > 0).length;
  const decide = (id: string, decision: string) =>
    setItems((all) =>
      all.map((item) =>
        item.thread.id !== id
          ? item
          : {
              ...item,
              decision,
              thread: {
                ...item.thread,
                activity: { ...item.thread.activity, pending: 0, state: "idle" },
              },
            },
      ),
    );
  const send = () => {
    if (!draft.trim()) return;
    const id = focused ?? `local-${Date.now()}`;
    if (focused)
      setItems((all) =>
        all.map((item) => (item.thread.id === id ? { ...item, reply: draft } : item)),
      );
    else
      setItems((all) => [
        {
          thread: { ...BAY_THREADS[0]!, id, title: draft.slice(0, 42) },
          kind: "finished",
          message:
            "Your new conversation starts here. This prototype keeps messages on this screen only.",
          reply: draft,
        },
        ...all,
      ]);
    setFocused(id);
    setExpanded((all) => (all.includes(id) ? all : [...all, id]));
    setDraft("");
    setNotice("Message kept in this fixture. No host contacted.");
  };

  if (windowState !== "open")
    return (
      <div data-surface="page" className="flex h-full w-full items-end justify-end p-5 text-ink">
        <Button label="Restore small Pea" kind="framed" onClick={() => setWindowState("open")}>
          Pea · {windowState} · restore
        </Button>
      </div>
    );

  return (
    <div
      data-surface="page"
      data-variant="6"
      className="flex h-full w-full flex-col text-ink"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {/* OWED: native draggable title bar and actual always-on-top/minimize/close; local simulation only. */}
      <header
        className="flex shrink-0 items-center gap-2 px-3 py-2 hairline-b"
        data-surface="artifact"
      >
        <div
          className="flex min-w-0 flex-1 cursor-move touch-none items-center gap-2"
          onPointerDown={(event) => {
            const handle = event.currentTarget;
            handle.setPointerCapture(event.pointerId);
            const origin = { x: event.clientX - offset.x, y: event.clientY - offset.y };
            handle.onpointermove = (move) =>
              setOffset({
                x: Math.max(-80, Math.min(80, move.clientX - origin.x)),
                y: Math.max(-80, Math.min(80, move.clientY - origin.y)),
              });
            handle.onpointerup = handle.onpointercancel = () => {
              handle.onpointermove = null;
            };
          }}
        >
          <GripHorizontal size={14} className="text-ink-2" />
          <span data-tone="pea" className="font-semibold">
            Pea
          </span>
          <span className="t-small text-ink-2">right here</span>
        </div>
        <Button label="Pin on top" icon={Pin} pressed={pinned} onClick={() => setPinned(!pinned)} />
        <Button label="Minimize Pea" icon={Minus} onClick={() => setWindowState("minimized")} />
        <Button label="Close Pea" icon={X} onClick={() => setWindowState("closed")} />
      </header>
      <div className="flex shrink-0 items-center justify-between gap-1 px-3 py-2 hairline-b">
        <MachineChip label="Revit 2025 ●">
          <span className="font-semibold">Revit on this machine</span>
          <span className="t-small text-ink-2">Hospital MEP.rvt · your session</span>
          {[2025, 2026, 2027].map((year) => (
            <div key={year} className="flex items-center justify-between gap-3">
              <span className="face-mono">
                {year} · {launched.includes(year) ? "running" : "stopped"}
              </span>
              <Button
                label={`Launch Revit ${year}`}
                refusal={launched.includes(year) ? "Already running in this fixture" : undefined}
                onClick={() => setLaunched((all) => [...all, year])}
              >
                Launch
              </Button>
            </div>
          ))}
        </MachineChip>
        <MachineChip label="0.7.24">
          <span className="font-semibold">Pe.Tools 0.7.24</span>
          <span>{update}</span>
          <Button
            label="Check for updates"
            onClick={() => setUpdate("Fixture checked · no update available")}
          >
            Check for updates
          </Button>
        </MachineChip>
        <MachineChip label="Share">
          <span className="font-semibold">Share this machine</span>
          <span>{sharing ? "Sharing enabled in fixture" : "Local only · sharing is off"}</span>
          <Button label="Toggle sharing" pressed={sharing} onClick={() => setSharing(!sharing)}>
            {sharing ? "Turn sharing off" : "Enable sharing"}
          </Button>
        </MachineChip>
        <MachineChip label="Providers">
          <span className="font-semibold">Pea providers</span>
          {["Claude", "Codex"].map((name) => (
            <Button
              key={name}
              label={`Use ${name}`}
              pressed={provider === name}
              onClick={() => setProvider(name)}
            >
              {name} · ready
            </Button>
          ))}
          <span className="t-small text-ink-2">Used for new conversations.</span>
        </MachineChip>
      </div>
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <div>
          <span className="font-semibold">Conversations</span>
          <span className="ml-2 face-mono t-small text-ink-2">{waiting} need you</span>
        </div>
        <Button
          label="New conversation"
          icon={Plus}
          onClick={() => {
            setFocused(null);
            setDraft("");
          }}
        >
          New
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5" aria-label="Conversation tickets">
        {items.map((item) => (
          <div
            key={item.thread.id}
            className="pb-3"
            data-selected={focused === item.thread.id ? "" : undefined}
          >
            <Accordion
              label={item.thread.title ?? "Conversation"}
              open={expanded.includes(item.thread.id) ? item.thread.id : null}
              onOpen={(key) => {
                setExpanded((all) =>
                  key ? [...all, key] : all.filter((id) => id !== item.thread.id),
                );
                if (key) setFocused(key);
              }}
              groups={[
                {
                  key: item.thread.id,
                  label: item.thread.title ?? "Conversation",
                  tone: item.thread.activity.pending
                    ? "caution"
                    : item.kind === "failed"
                      ? "alarm"
                      : undefined,
                  state: item.decision ? "Reviewed" : (activityWord(item.thread) ?? "Finished"),
                  body: (
                    <div className="pt-3">
                      <MessageHead role="assistant" harness="claude" />
                      <ConversationBody role="assistant">
                        <Markdown text={item.message} />
                      </ConversationBody>
                      {item.kind === "proposal" && (
                        <div className="my-3 p-3 hairline-t hairline-b" data-surface="artifact">
                          <div className="mb-2 flex justify-between t-small">
                            <span>Family proposal</span>
                            <span className="face-mono text-ink-2">3 changes</span>
                          </div>
                          {[
                            ["Return direction", "In", "Out"],
                            ["Flow", "450", "520 CFM"],
                            ["System", "Undefined", "Return air"],
                          ].map(([name, from, to]) => (
                            <div key={name} className="flex justify-between gap-2 py-1">
                              <span className="t-small">{name}</span>
                              <ValueDiff from={from} to={to!} />
                            </div>
                          ))}
                          {!item.decision && (
                            <div className="mt-3 flex gap-2">
                              <Button
                                label="Accept 3 changes"
                                kind="commit"
                                onClick={() =>
                                  decide(item.thread.id, "Accepted 3 changes · fixture only")
                                }
                              >
                                Accept 3 changes
                              </Button>
                              <Button
                                label="Reject proposal"
                                onClick={() =>
                                  decide(item.thread.id, "Proposal rejected · fixture only")
                                }
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      {item.kind === "approval" && !item.decision && (
                        <div className="mt-3 flex gap-2">
                          <Button
                            label="Allow tag placement once"
                            kind="commit"
                            onClick={() => decide(item.thread.id, "Allowed once · fixture only")}
                          >
                            Allow once
                          </Button>
                          <Button
                            label="Deny tag placement"
                            onClick={() =>
                              decide(item.thread.id, "Permission denied · fixture only")
                            }
                          >
                            Deny
                          </Button>
                        </div>
                      )}
                      {item.decision && (
                        <p className="my-2 t-small text-ink-2" role="status">
                          {item.decision}
                        </p>
                      )}
                      {item.reply && (
                        <div className="mt-3">
                          <MessageHead role="user" />
                          <MessageBubble>{item.reply}</MessageBubble>
                        </div>
                      )}
                      <div className="mt-2 flex justify-end">
                        <Button
                          label={`Reply to ${item.thread.title}`}
                          pressed={focused === item.thread.id}
                          onClick={() => {
                            setFocused(item.thread.id);
                          }}
                        >
                          Reply here
                        </Button>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ))}
      </div>
      {/* OWED: ThreadComposer requires Workbench + route handle; reuse its presentational pieces with local send. Attachments, mentions and model execution remain absent. */}
      <div className="shrink-0 pt-3 hairline-t">
        <ComposerFrame>
          <Composer
            work={
              <div className="flex items-center justify-between gap-2 px-3 pt-2 t-small text-ink-2">
                <span className="truncate">
                  {current ? `Reply · ${current.thread.title}` : "New conversation"}
                </span>
                {current && (
                  <Button label="Clear reply target" icon={X} onClick={() => setFocused(null)} />
                )}
              </div>
            }
            aria-label="Message Pea"
            placeholder={current ? "Tell Pea what comes next…" : "What can I help you with?"}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onSend={send}
            pickers={<span className="t-small">{provider} · Hospital MEP</span>}
            send={
              <Button
                label="Send message"
                icon={ArrowUp}
                kind="commit"
                refusal={!draft.trim() ? "Write a message first" : undefined}
                onClick={send}
              />
            }
          />
        </ComposerFrame>
        <div className="flex justify-between gap-2 px-4 pb-3 t-small text-ink-2">
          <span role="status">{notice || "Fixture · small Pea / tray experiment"}</span>
          <span className="shrink-0">{pinned ? "Pinned" : "Unpinned"}</span>
        </div>
      </div>
    </div>
  );
}
