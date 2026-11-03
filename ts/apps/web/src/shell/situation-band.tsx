import type { AdmittedMount } from "./admitted-mount";
/**
 * ADR 0027 rule 3: the Situation is one line. The route's name and context lead, one primary verb
 * stands framed, the rest wait in an overflow, and the Timeline head closes the line. Layout only:
 * mount-chrome.tsx renders each verb and each context control; this file owns where they sit.
 *
 * The Timeline head's Reject answers the same host consent API as Pea's composer (`thread.permission`).
 * TODO: docs/features/routes/LEDGER.md#s7-a91a2429a1 H2 — Reject dispatch and host cancellation are proven separately by fixture tests; press it against a live
 * host consent window (a route command from a Pea thread) to prove the round trip.
 */
import { useContext, useSyncExternalStore, type ReactNode } from "react";
import { MoreHorizontal, Redo2, Undo2 } from "lucide-react";
import { workKey, type VerbDecl } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { selectApprovals } from "@pe/agent-contracts/chat-state";
import { harnessClient } from "#/workbench/provider/harness-client";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import type { GraphMount } from "./mount-owner";
import { activityTime, type TimelineEntry } from "./timeline";
import { secondsLeft, useSecondTick } from "./countdown";
import "./situation-band.css";

export function SituationBand({
  label = "Situation",
  name,
  context,
  verbs,
  alerts,
  timeline,
}: {
  label?: string;
  name: string;
  /** Document target, stage switch, subject words and situation fields, in that order. */
  context: ReactNode;
  /** Declared order is the ranking: the first is the primary verb, the rest overflow. */
  verbs: readonly ReactNode[];
  /** Conflict, unaccepted edit, Stop and refusals: they interrupt, so they never overflow. */
  alerts: ReactNode;
  timeline?: ReactNode;
}) {
  const [primary, ...rest] = verbs;
  return (
    <section aria-label={label} data-slot="situation-band" data-surface="page">
      <b data-slot="situation-name">{name}</b>
      <span data-slot="situation-context">{context}</span>
      <span data-slot="situation-alerts">{alerts}</span>
      <span data-slot="situation-verbs">
        {primary}
        {rest.length > 0 && (
          <Popover>
            <PopoverTrigger
              aria-label={`${rest.length} more ${name} verbs`}
              data-slot="situation-more"
            >
              <MoreHorizontal aria-hidden className="size-4" />
              {rest.length}
            </PopoverTrigger>
            <SubjectPopoverContent aria-label={`More ${name} verbs`}>
              <span data-slot="situation-overflow">{rest}</span>
            </SubjectPopoverContent>
          </Popover>
        )}
      </span>
      {timeline}
    </section>
  );
}

/**
 * The band's ranking: the verb that declares `primary`, else the stage's first model write (its
 * press previews, then applies: ADR 0027 rule 10), else the first declared. The rest keep their order.
 */
export function rankVerbs(ids: readonly string[], verbs: Readonly<Record<string, VerbDecl>>) {
  const primary =
    ids.find((id) => verbs[id]?.primary) ??
    ids.find((id) => verbs[id]?.effect === "command") ??
    ids[0];
  return primary === undefined ? [] : [primary, ...ids.filter((id) => id !== primary)];
}

/** The thread whose run consent a receipt waits on: Pea's own, else the route's bound thread. */
function consentThread(entry: TimelineEntry, bound?: string) {
  const caller = (entry.basis as { receipt?: { caller?: { kind: string; thread?: string } } })
    ?.receipt?.caller;
  return caller?.kind === "pea" ? caller.thread : bound;
}

/** Who ran an entry: a receipt names its caller; a press on this page is yours. */
export const entryCaller = (entry: TimelineEntry) =>
  (entry.basis as { receipt?: { caller?: { kind: string } } } | undefined)?.receipt?.caller
    ?.kind === "pea"
    ? "Pea"
    : "you";

/** An invocation still waiting on its consent window; every other state has resolved it. */
const WAITING = new Set(["queued", "running"]);

/**
 * The latest entry per press or receipt; a consent window is open until its entry moves on. A
 * cancelled, refused, failed or succeeded receipt that still carries the window it was stamped
 * with is resolved: it leaves the head at once (D8, "apply · 17s / Reject?" beside "cancelled").
 */
export function openConsentWindows(entries: readonly TimelineEntry[], now = Date.now()) {
  const latest = new Map<string, TimelineEntry>();
  entries.forEach((entry, index) =>
    latest.set(entry.outcome?.receiptId ?? entry.press ?? `entry:${index}`, entry),
  );
  return [...latest.values()].flatMap((entry) => {
    const window = entry.outcome?.consentWindow;
    if (!window || !WAITING.has(entry.outcome!.state)) return [];
    const left = window.deadline ? secondsLeft(window.deadline, now) : null;
    return left === null || left > 0 ? [{ entry, left }] : [];
  });
}

/** The Work journal behind the owner's current scope: the one history of authored edits. */
type HistoryOwner<P, W> = GraphMount<P, W> | AdmittedMount;
export function useWorkJournal<P, W>(owner: HistoryOwner<P, W>) {
  const version = "restoreWork" in owner ? owner.revision : owner.version;
  useSyncExternalStore(owner.subscribe, version, version);
  if ("restoreWork" in owner) return owner.journal();
  const scope = owner.snapshot();
  const key = scope.work?.handle.key ?? scope.workKey ?? scope.unreadable;
  return key ? (owner.journals.get(workKey(key))?.read() ?? null) : null;
}
type Journal = NonNullable<ReturnType<typeof useWorkJournal>>;
export const stepSource = (step: Journal["undo"][number]) => (step.by === "pea" ? "Pea" : "you");
export const stepState = (journal: Journal, step: Journal["undo"][number]) =>
  step.notWritten
    ? step.notWritten.rejected
      ? "not written — rejected"
      : "not written"
    : step.superseded
      ? `superseded at r${step.superseded.revision}`
      : step.barrier
        ? (step.barrier.basis as { receiptId?: string } | undefined)?.receiptId
          ? "applied"
          : "blocked"
        : journal.redo.some((entry) => entry.press === step.press)
          ? "undone"
          : "applied";

/** The journal's latest move as words: who edited, or who undid/redid it (Pea's undo is a step too). */
export const lastMove = (journal: Journal) => {
  const { kind, step, by } = journal.last!;
  const who = by === "pea" ? "Pea" : "you";
  return kind === "apply"
    ? `${stepSource(step)} · ${stepState(journal, step)}`
    : `${who} ${kind === "undo" ? "undid" : "redid"}`;
};

/**
 * Undo and redo over this Work's journal, as the head and the History both draw them: the same
 * restore Mod+Z runs, refused with the journal's own reason. `words` draws the labels beside the
 * glyphs (the History); the head draws glyphs alone, their names as tooltips.
 */
export function JournalButtons<P, W>({
  owner,
  words = false,
}: {
  owner: HistoryOwner<P, W>;
  words?: boolean;
}) {
  const journal = useWorkJournal(owner);
  if (!journal) return null;
  const undo = journal.undo.at(-1);
  const redo = journal.redo.at(-1);
  return (
    <>
      <Button
        icon={Undo2}
        label={undo ? `Undo ${undo.label}` : "Undo"}
        refusal={
          owner.journalRefusal() ??
          undo?.superseded?.message ??
          (undo ? null : "Nothing to undo: no edit to this Work since this tab opened it")
        }
        onClick={() =>
          void ("restoreWork" in owner ? owner.restoreWork("undo") : owner.restore("undo"))
        }
      >
        {words ? "undo" : undefined}
      </Button>
      <Button
        icon={Redo2}
        label={redo ? `Redo ${redo.label}` : "Redo"}
        refusal={
          owner.journalRefusal() ?? redo?.superseded?.message ?? (redo ? null : "Nothing to redo")
        }
        onClick={() =>
          void ("restoreWork" in owner ? owner.restoreWork("redo") : owner.restore("redo"))
        }
      >
        {words ? "redo" : undefined}
      </Button>
    </>
  );
}

/**
 * The Timeline's head: the latest Work edit (who made it, its state, the Work revision), unless a
 * command ran after it; else the latest entry, in one line and every open consent window as its
 * "Reject?" countdown. The full history opens beneath it; it never takes a row of its own.
 */
export function TimelineHead<P, W>({
  owner,
  history,
  thread,
  verbs: declaredVerbs,
}: {
  owner: HistoryOwner<P, W>;
  verbs?: Readonly<Record<string, { label: string; kind: string }>>;
  history: ReactNode;
  thread?: string;
}) {
  const admitted = "restoreWork" in owner;
  const version = admitted ? owner.revision : owner.timeline.version;
  useSyncExternalStore(
    admitted ? owner.subscribe : (notify) => owner.timeline.subscribe(notify),
    version,
    version,
  );
  const timeline: readonly TimelineEntry[] = admitted ? owner.timeline() : owner.timeline.read();
  const verbs = declaredVerbs ?? (admitted ? {} : owner.verbs);
  const labelOf = (id?: string) =>
    admitted ? ((id ? verbs[id]?.label : undefined) ?? "Command") : (id ?? "Command");
  // The selected thread's run consent (ADR 0027 rule 11) is the same window Pea's composer card
  // answers; the head shows it too, so a "Reject?" countdown is never only inside the chat pane.
  const workbench = useContext(WorkbenchContext);
  const runAsks = workbench
    ? selectApprovals(workbench.chat).filter((ask) => ask.scope === "run")
    : [];
  // One host window is one countdown: a receipt stamped with a window the run ask already draws
  // is not drawn twice. Both read the host's deadline from the clock at render (countdown.ts).
  const asked = new Set(runAsks.map((ask) => ask.requestId));
  const windows = openConsentWindows(timeline).filter(
    ({ entry }) => !asked.has(entry.outcome!.consentWindow!.requestId),
  );
  useSecondTick(windows.some((open) => open.left !== null) || runAsks.some((ask) => ask.deadline));
  const journal = useWorkJournal(owner);
  const step = journal?.last?.step;
  // A command press or any receipt (Pea's previews included, ADR 0028) outranks an older Work edit.
  const command = [...timeline]
    .reverse()
    .find((entry) => entry.kind === "receipt" || verbs[entry.verb ?? ""]?.kind === "command");
  const last =
    step && !(command && new Date(command.at).getTime() > step.at)
      ? null
      : (command ?? timeline.at(-1));
  return (
    <span data-slot="timeline-head" role="group" aria-label="Timeline">
      {windows.map(({ entry, left }) => {
        const window = entry.outcome!.consentWindow!;
        const consent = consentThread(entry, thread);
        return (
          <span key={entry.outcome?.receiptId ?? entry.press} data-slot="consent-window">
            <span role="timer" data-tone="caution" aria-label={`${labelOf(entry.verb)} applies in`}>
              {labelOf(entry.verb)} · {left === null ? "awaiting approval" : `${left}s`}
            </span>
            <Button
              label={`Reject ${labelOf(entry.verb)}`}
              refusal={
                (!admitted ? owner.commandRefusal : owner.journalRefusal()) ??
                (consent ? null : "No thread holds this consent window")
              }
              onClick={() =>
                // `stop_writes` is the host's reject option (run-consent.ts): it closes the window
                // and stops this thread's writes until a fresh consent.
                void harnessClient(resolveWorkbenchConfig().origin).permission(
                  consent!,
                  window.requestId,
                  "stop_writes",
                )
              }
            >
              Reject?
            </Button>
          </span>
        );
      })}
      {runAsks.map((ask) => {
        const left = ask.deadline ? secondsLeft(ask.deadline) : null;
        const reject = ask.options.find((option) => option.kind.startsWith("reject"));
        return (
          <span key={ask.requestId} data-slot="consent-window">
            <span role="timer" data-tone="caution" aria-label="Pea's writes apply in">
              Pea writes · {left === null ? "awaiting approval" : `${left}s`}
            </span>
            <Button
              label="Reject Pea's writes in this thread"
              refusal={reject ? null : "This consent window offers no reject option"}
              onClick={() => void workbench!.resolveApproval(ask.requestId, reject!.optionId)}
            >
              Reject?
            </Button>
          </span>
        );
      })}
      <Popover>
        <PopoverTrigger aria-label="Open the Timeline" data-slot="timeline-trigger">
          {step && !last ? (
            <>
              <span>{step.label}</span>
              <span data-slot="timeline-state">
                {lastMove(journal!)} · r{journal!.revision}
              </span>
            </>
          ) : last ? (
            <>
              <span>{labelOf(last.verb)}</span>
              <span data-slot="timeline-state">
                {entryCaller(last)} · {last.outcome?.state ?? last.kind} · {activityTime(last.at)}
              </span>
            </>
          ) : (
            <span data-slot="timeline-state">No activity yet</span>
          )}
        </PopoverTrigger>
        <SubjectPopoverContent
          aria-label="Timeline"
          className="max-h-(--available-height) overflow-y-auto"
        >
          {history}
        </SubjectPopoverContent>
      </Popover>
      <JournalButtons owner={owner} />
    </span>
  );
}
