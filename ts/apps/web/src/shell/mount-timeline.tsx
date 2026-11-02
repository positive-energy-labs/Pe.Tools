import { useEffect, useState } from "react";
import {
  invocationOutcome,
  actionStatusSchema,
  receiptsForWork,
  routeAddress,
} from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import type { GraphMount } from "./mount-owner";
import { entryCaller, lastMove, stepState, useWorkJournal } from "./situation-band";
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
  const undo = journal?.undo.at(-1);
  const redo = journal?.redo.at(-1);
  const saved =
    !workOnly && parsed.success ? (key ? receiptsForWork(parsed.data, key) : parsed.data) : [];
  const recorded = new Set(saved.map((receipt) => receipt.id));
  const shown = entries.filter(
    (entry) => (!workOnly || owner.verbs[entry.verb ?? ""]?.kind === "work") &&
      !(entry.kind === "invocation" && entries.some((receipt) =>
        receipt.kind === "receipt" && receipt.outcome &&
        (receipt.press === entry.press || receipt.outcome.receiptId === entry.outcome?.receiptId) &&
        (receipt.press != null || receipt.outcome.receiptId != null))),
  );
  return (
    <section aria-label={label}>
      {reading?.status === "failed" && <p role="alert">{reading.error}</p>}
      {!shown.length && !saved.length && !moves.length && <p>No activity yet</p>}
      {journal && (
        <p>
          Work r{journal.revision ?? "?"}
          {journal.last && journal.last.kind !== "apply" && (
            <>
              {" "}
              · {lastMove(journal)} {journal.last.step.label}
            </>
          )}{" "}
          <Button
            label={undo ? `Undo ${undo.label}` : "Undo"}
            refusal={
              owner.journalRefusal() ??
              undo?.superseded?.message ??
              (undo ? null : "Nothing to undo: no edit to this Work since this tab opened it")
            }
            onClick={() => void owner.restore("undo")}
          >
            undo
          </Button>{" "}
          <Button
            label={redo ? `Redo ${redo.label}` : "Redo"}
            refusal={
              owner.journalRefusal() ??
              redo?.superseded?.message ??
              (redo ? null : "Nothing to redo")
            }
            onClick={() => void owner.restore("redo")}
          >
            redo
          </Button>
        </p>
      )}
      <ol>
        {moves.map((entry) => {
          const step = steps.find((candidate) => candidate.press === entry.press);
          return (
            <li key={`work:${entry.revision}:${entry.kind}`}>
              {entry.kind === "apply" ? "" : entry.kind === "undo" ? "undid " : "redid "}
              {entry.label} · {entry.by === "pea" ? "Pea" : "you"} ·{" "}
              {entry.kind === "apply" && step ? stepState(journal!, step) : `r${entry.revision}`} ·{" "}
              {activityTime(entry.at)}
              {entry.kind === "apply" && step?.superseded && <> · {step.superseded.message}</>}
            </li>
          );
        })}
        {[
          ...shown
            .filter((entry) => {
              const receipt = (entry.basis as { receipt?: { id: string } } | undefined)?.receipt;
              return !recorded.has(receipt?.id ?? entry.receiptId ?? "");
            })
            .map((entry, index) => (
              <li key={`event:${index}`}>
                {entry.verb ?? entry.kind} · {entry.outcome?.state ?? entry.kind} ? {entryCaller(entry)} ·{" "}
                {activityTime(
                  entry.at,
                  entry.kind === "receipt" && entry.press
                    ? entries.find(
                        (start) => start.kind === "invocation" && start.press === entry.press,
                      )?.at
                    : undefined,
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
                {entry.outcome?.consentWindow && (
                  <>
                    {" "}
                    | Consent open
                    {entry.outcome.consentWindow.deadline
                      ? ` until ${activityTime(entry.outcome.consentWindow.deadline)}`
                      : "; awaiting approval"}
                  </>
                )}
                {entry.kind === "feed" && <> · {JSON.stringify(entry.subject)}</>}
              </li>
            )),
          ...[...saved]
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .map((receipt) => (
              <li key={receipt.id}>
                <a href={routeAddress("ops").link({ actionId: receipt.id })}>{receipt.key}</a> ·{" "}
                {invocationOutcome(receipt).state} ? {receipt.caller.kind === "pea" ? "Pea" : "you"} · {activityTime(receipt.startedAt)}
                {invocationOutcome(receipt).recovery && (
                  <>
                    {" "}
                    |{" "}
                    <a href={routeAddress("ops").link({ actionId: receipt.id })}>
                      {invocationOutcome(receipt).recovery}
                    </a>
                  </>
                )}
                {receipt.consentWindow && (
                  <>
                    {" "}
                    | Consent open
                    {receipt.consentWindow.deadline
                      ? ` until ${activityTime(receipt.consentWindow.deadline)}`
                      : "; awaiting approval"}
                  </>
                )}
                {"error" in receipt && receipt.error ? ` · ${String(receipt.error)}` : ""}
              </li>
            )),
        ]}
      </ol>
    </section>
  );
}
