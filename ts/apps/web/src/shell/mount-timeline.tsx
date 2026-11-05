import { useList } from "@pe/kit/lang/collection";
import { Button } from "@pe/kit/lang/button";
import { ListView } from "@pe/kit/lang/list-view";
import { teachText } from "@pe/kit/lang/use-teach";
import { useEffect, useState } from "react";
import { actionStatusSchema, receiptsForWork, routeAddress } from "@pe/agent-contracts";
import { readingList } from "./mount-reading";
import type { GraphMount } from "./mount-owner";
import type { AdmittedMount } from "./admitted-mount";
import { entryCaller, stepState, useWorkJournal } from "./situation-band";
import { activityTime, projectTimeline, type TimelineVerbs } from "./timeline";

/** One History presentation for graph panes: accepted calls and exact Work receipts. */
export function GraphHistory<P, W>({
  owner,
  receipts,
  workOnly = false,
  label = "History",
  verbs: declaredVerbs,
}: {
  owner: GraphMount<P, W> | AdmittedMount;
  verbs?: TimelineVerbs;
  receipts?: string;
  workOnly?: boolean;
  label?: string;
}) {
  const admitted = "restoreWork" in owner;
  const readTimeline = () => (admitted ? owner.timeline() : owner.timeline.read());
  const [entries, setEntries] = useState(readTimeline);
  useEffect(
    () =>
      admitted
        ? owner.subscribe(() => setEntries(readTimeline()))
        : owner.timeline.subscribe(() => setEntries(readTimeline())),
    [owner],
  );
  const journal = useWorkJournal(owner);
  const reading = !admitted && receipts ? owner.readings.get(receipts) : null;
  const receiptRows = reading
    ? readingList(reading, (value) => {
        const parsed = actionStatusSchema.array().safeParse(value);
        return parsed.success ? parsed.data : [];
      })
    : null;
  const scope = !admitted ? owner.snapshot() : null;
  const key = scope?.work?.handle.key ?? scope?.workKey ?? scope?.unreadable;
  const saved = !workOnly
    ? key
      ? receiptsForWork(receiptRows?.items ?? [], key)
      : (receiptRows?.items ?? [])
    : [];
  const verbs = declaredVerbs ?? (admitted ? {} : owner.verbs);
  const projected = projectTimeline(
    [
      ...saved.map((receipt) => ({
        kind: "receipt" as const,
        at: receipt.startedAt,
        receiptId: receipt.id,
        basis: { receipt },
      })),
      ...entries,
    ],
    verbs,
    journal,
  );
  const rows = [...projected]
    .reverse()
    .filter((row) => !workOnly || row.kind === "journal")
    .map((row) => ({
      key: row.key,
      label: row.entry.receiptId ? (
        <a href={routeAddress("ops").link({ actionId: row.entry.receiptId })}>{row.verb}</a>
      ) : (
        row.verb
      ),
      sub: [
        row.move
          ? `${row.move.kind} / ${row.move.by === "pea" ? "Pea" : "you"} / ${row.move.kind === "apply" && row.step ? stepState(journal!, row.step) : `r${row.move.revision}`}`
          : `${row.outcome?.state ?? row.kind} / ${entryCaller(row.entry)}`,
        activityTime(row.at, row.startedAt),
        row.outcome?.reason,
        row.move?.kind === "apply" ? row.step?.superseded?.message : undefined,
        row.kind === "feed"
          ? (row.entry.subject as { message?: string } | null)?.message
          : undefined,
        row.kind === "consent"
          ? `Consent open${row.consentUntil ? ` until ${activityTime(row.consentUntil)}` : "; awaiting approval"}`
          : undefined,
      ]
        .filter(Boolean)
        .join(" / "),
      actions: (
        <>
          {row.outcome?.recovery && row.outcome.receiptId && (
            <a href={routeAddress("ops").link({ actionId: row.outcome.receiptId })}>
              {row.outcome.recovery}
            </a>
          )}
          {admitted &&
            row.entry.receiptId &&
            ["queued", "running", "outcome-unknown"].includes(row.outcome?.state ?? "") && (
              <Button
                label="Stop command"
                onClick={() => void owner.stopCommand(row.entry.receiptId!)}
              >
                Stop
              </Button>
            )}
        </>
      ),
    }));
  const list = useList({
    items: rows,
    status: receiptRows?.status,
    failure: receiptRows?.failure,
    keyOf: (row) => row.key,
    search: (row) => ({ text: [teachText(row.label), row.sub] }),
    select: "none",
  });
  return (
    <section aria-label={label}>
      <ListView
        list={list}
        aria-label={label}
        maxHeight="min(24rem, 60vh)"
        row={(row) => ({
          label: row.label,
          sub: row.sub,
          actions: row.actions,
          title: teachText(row.label),
          lines: 3,
        })}
        empty={{ message: "No activity yet", exit: "Run a command or edit Work" }}
      />
    </section>
  );
}
