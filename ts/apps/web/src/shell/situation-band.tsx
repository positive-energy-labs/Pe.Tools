/**
 * ADR 0027 rule 3: the Situation is one line. The route's name and context lead, one primary verb
 * stands framed, the rest wait in an overflow, and the Timeline head closes the line. Layout only:
 * mount.tsx renders each verb and each context control; this file owns where they sit.
 *
 * The Timeline head's Reject answers the same host consent API as Pea's composer (`thread.permission`).
 * TODO: H2 — Reject is proven rendered and inert on the fixture lane only; press it against a live
 * host consent window (a route command from a Pea thread) to prove the round trip.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import type { VerbDecl } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import type { GraphMount } from "./mount-owner";
import { activityTime, type TimelineEntry } from "./timeline";
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

/** The latest entry per press or receipt; a consent window is open until its entry moves on. */
export function openConsentWindows(entries: readonly TimelineEntry[], now: number) {
  const latest = new Map<string, TimelineEntry>();
  entries.forEach((entry, index) =>
    latest.set(entry.outcome?.receiptId ?? entry.press ?? `entry:${index}`, entry),
  );
  return [...latest.values()].flatMap((entry) => {
    const window = entry.outcome?.consentWindow;
    if (!window) return [];
    const left = window.deadline ? Math.ceil((Date.parse(window.deadline) - now) / 1000) : null;
    return left === null || left > 0 ? [{ entry, left }] : [];
  });
}

/**
 * The Timeline's head: the latest entry in one line and every open consent window as its
 * "Reject?" countdown. The full history opens beneath it; it never takes a row of its own.
 */
export function TimelineHead<P, W>({
  owner,
  history,
  thread,
}: {
  owner: GraphMount<P, W>;
  history: ReactNode;
  thread?: string;
}) {
  const length = () => owner.timeline.read().length;
  const entries = useSyncExternalStore((notify) => owner.timeline.subscribe(notify), length, length);
  const timeline = entries ? owner.timeline.read() : [];
  const [now, setNow] = useState(Date.now);
  const windows = openConsentWindows(timeline, now);
  const ticking = windows.some((open) => open.left !== null);
  useEffect(() => {
    if (!ticking) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [ticking]);
  const last = timeline.at(-1);
  return (
    <span data-slot="timeline-head" role="group" aria-label="Timeline">
      {windows.map(({ entry, left }) => {
        const window = entry.outcome!.consentWindow!;
        const consent = consentThread(entry, thread);
        return (
          <span key={entry.outcome?.receiptId ?? entry.press} data-slot="consent-window">
            <span role="timer" data-tone="caution" aria-label={`${entry.verb ?? "Command"} applies in`}>
              {entry.verb ?? "command"} · {left === null ? "awaiting approval" : `${left}s`}
            </span>
            <Button
              label={`Reject ${entry.verb ?? "command"}`}
              refusal={
                owner.fixture
                  ? "Fixture lane: host commands disabled"
                  : consent
                    ? null
                    : "No thread holds this consent window"
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
      <Popover>
        <PopoverTrigger aria-label="Open the Timeline" data-slot="timeline-trigger">
          {last ? (
            <>
              <span>{last.verb ?? last.kind}</span>
              <span data-slot="timeline-state">
                {last.outcome?.state ?? last.kind} · {activityTime(last.at)}
              </span>
            </>
          ) : (
            <span data-slot="timeline-state">No activity yet</span>
          )}
        </PopoverTrigger>
        <SubjectPopoverContent aria-label="Timeline" className="max-h-(--available-height) overflow-y-auto">
          {history}
        </SubjectPopoverContent>
      </Popover>
    </span>
  );
}
