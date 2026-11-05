import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { teachText } from "@pe/kit/lang/use-teach";
import { useEffect, useState } from "react";
import {
  invocationOutcome,
  actionStatusSchema,
  receiptsForWork,
  routeAddress,
} from "@pe/agent-contracts";
import type { GraphMount } from "./mount-owner";
import { JournalButtons, entryCaller, lastMove, stepState, useWorkJournal } from "./situation-band";
import { activityTime } from "./timeline";

/** One History presentation for graph panes: accepted calls and exact Work receipts. */
export function GraphHistory<P, W>({
  owner,
  receipts,
  workOnly = false,
  label = "History",
}: {
  owner: GraphMount<P, W>;
  receipts?: string;
  workOnly?: boolean;
  label?: string;
}) {
  const [entries, setEntries] = useState(() => owner.timeline.read());
  useEffect(() => owner.timeline.subscribe(() => setEntries(owner.timeline.read())), [owner]);
  const journal = useWorkJournal(owner);
  const reading = receipts ? owner.readings.get(receipts) : null;
  const parsed = actionStatusSchema.array().safeParse(reading?.value ?? reading?.previous);
  const scope = owner.snapshot();
  const key = scope.work?.handle.key ?? scope.workKey ?? scope.unreadable;
  // Newest first, as the receipts below: every edit, undo and redo is its own entry.
  const steps = journal ? [...journal.redo, ...journal.undo] : [];
  const moves = journal ? [...journal.moves].reverse() : [];
  const saved =
    !workOnly && parsed.success ? (key ? receiptsForWork(parsed.data, key) : parsed.data) : [];
  const recorded = new Set(saved.map((receipt) => receipt.id));
  const shown = entries.filter(
    (entry) =>
      (!workOnly || owner.verbs[entry.verb ?? ""]?.kind === "work") &&
      !(
        entry.kind === "invocation" &&
        owner.verbs[entry.verb ?? ""]?.kind === "work" &&
        moves.some((move) => move.press === entry.press)
      ) &&
      !(
        entry.kind === "invocation" &&
        entries.some(
          (receipt) =>
            receipt.kind === "receipt" &&
            receipt.outcome &&
            (receipt.press === entry.press ||
              receipt.outcome.receiptId === entry.outcome?.receiptId) &&
            (receipt.press != null || receipt.outcome.receiptId != null),
        )
      ),
  );
  const rows = [
        ...moves.map((entry) => {
          const step = steps.find((candidate) => candidate.press === entry.press);
          return (
            { key: `work:${entry.revision}:${entry.kind}`, label: <>
              {entry.kind === "apply" ? "" : entry.kind === "undo" ? "undid " : "redid "}
              {entry.label} · {entry.by === "pea" ? "Pea" : "you"} ·{" "}
              {entry.kind === "apply" && step ? stepState(journal!, step) : `r${entry.revision}`} ·{" "}
              {activityTime(entry.at)}
              {entry.kind === "apply" && step?.superseded && <> · {step.superseded.message}</>}
            </> }
          );
        }),
        ...shown
            .filter((entry) => {
              const receipt = (entry.basis as { receipt?: { id: string } } | undefined)?.receipt;
              return !recorded.has(receipt?.id ?? entry.receiptId ?? "");
            })
            .map((entry, index) => (
              { key: `event:${index}`, label: <>
                {(entry.verb && owner.verbs[entry.verb]?.label) ?? entry.kind} ·{" "}
                {entry.outcome?.state ?? entry.kind} · {entryCaller(entry)} ·{" "}
                {activityTime(
                  entry.at,
                  entry.kind === "receipt" &&
                    entry.press &&
                    !(entry.basis as { receipt?: unknown } | undefined)?.receipt
                    ? entries.find(
                        (start) => start.kind === "invocation" && start.press === entry.press,
                      )?.at
                    : undefined,
                )}
                {entry.kind === "feed" &&
                  typeof (entry.subject as { message?: unknown } | null)?.message === "string" && (
                    <> | {String((entry.subject as { message: string }).message)}</>
                  )}
                {entry.outcome?.reason && <> | {entry.outcome.reason}</>}
                {entry.outcome?.recovery && entry.outcome.receiptId && (
                  <>
                    {" "}
                    |{" "}
                    <a href={routeAddress("ops").link({ actionId: entry.outcome.receiptId })}>
                      {entry.outcome.recovery}
                    </a>
                  </>
                )}
                {entry.outcome?.consentWindow && ["queued", "running"].includes(entry.outcome.state) && (
                  <>
                    {" "}
                    | Consent open
                    {entry.outcome.consentWindow.deadline
                      ? ` until ${activityTime(entry.outcome.consentWindow.deadline)}`
                      : "; awaiting approval"}
                  </>
                )}
              </> }
            )),
          ...[...saved]
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .map((receipt) => (
              { key: receipt.id, label: <>
                <a href={routeAddress("ops").link({ actionId: receipt.id })}>
                  {Object.values(owner.verbs).find((verb) => verb.does === receipt.key)?.label ??
                    receipt.key}
                </a>{" "}
                · {invocationOutcome(receipt).state} ·{" "}
                {receipt.caller.kind === "pea" ? "Pea" : "you"} · {activityTime(receipt.startedAt)}
                {invocationOutcome(receipt).recovery && (
                  <>
                    {" "}
                    |{" "}
                    <a href={routeAddress("ops").link({ actionId: receipt.id })}>
                      {invocationOutcome(receipt).recovery}
                    </a>
                  </>
                )}
                {receipt.consentWindow && ["queued", "running"].includes(invocationOutcome(receipt).state) && (
                  <>
                    {" "}
                    | Consent open
                    {receipt.consentWindow.deadline
                      ? ` until ${activityTime(receipt.consentWindow.deadline)}`
                      : "; awaiting approval"}
                  </>
                )}
                {"error" in receipt && receipt.error ? ` · ${String(receipt.error)}` : ""}
              </> }
            )),
  ];
  const list = useList({ items: rows, keyOf: (row) => row.key,
    search: (row) => ({ text: [teachText(row.label)] }), select: "none" });
  return (
    <section aria-label={label}>
      {reading?.status === "failed" && <p role="alert">{reading.error}</p>}
      {journal && (
        <p>
          Work r{journal.revision ?? "?"}
          {journal.last && journal.last.kind !== "apply" && (
            <>
              {" "}
              · {lastMove(journal)} {journal.moves.at(-1)?.label}
            </>
          )}{" "}
          <JournalButtons owner={owner} words />
        </p>
      )}
      <ListView list={list} aria-label={label} maxHeight="min(24rem, 60vh)"
        row={(row) => ({ label: row.label, title: teachText(row.label), lines: 3 })}
        empty={{ message: "No activity yet", exit: "Run a command or edit Work" }} />
    </section>
  );
}
