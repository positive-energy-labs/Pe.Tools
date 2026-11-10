import { useList } from "@pe/kit/lang/collection";
import { Button } from "@pe/kit/lang/button";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { ListView } from "@pe/kit/lang/list-view";
import { teachText } from "@pe/kit/lang/use-teach";
import { useEffect, useState } from "react";
import { routeAddress } from "@pe/agent-contracts";
import type { JournalOwner } from "./situation-band";
import { entryCaller, stepState, useWorkJournal } from "./situation-band";
import { activityTime, projectTimeline, type TimelineVerbs } from "./timeline";

/** One History presentation for graph panes: accepted calls and exact Work receipts. */
export function GraphHistory({
  owner,
  workOnly = false,
  label = "History",
  verbs: declaredVerbs,
}: {
  owner: JournalOwner;
  verbs?: TimelineVerbs;
  workOnly?: boolean;
  label?: string;
}) {
  const [entries, setEntries] = useState(owner.timeline);
  useEffect(() => owner.subscribe(() => setEntries(owner.timeline())), [owner]);
  const journal = useWorkJournal(owner);
  const verbs = declaredVerbs ?? {};
  const projected = projectTimeline(entries, verbs, journal);
  const rows = [...(journal?.intents ?? []).map(intent => ({
    key: `intent:${intent.id}`, label: intent.label,
    sub: `${intent.status} / ${intent.owner.route} / expected r${intent.input.expectedRevision} / ${intent.reason ?? "Awaiting acknowledgement"}`,
    actions: <><Popover><PopoverTrigger aria-label={`Inspect ${intent.label}`}>Inspect</PopoverTrigger>
      <SubjectPopoverContent aria-label={`Original input: ${intent.label}`}><pre>{JSON.stringify(intent,null,2)}</pre></SubjectPopoverContent>
    </Popover>{owner.discardIntent && <Button label={`Discard ${intent.label}`} refusal={intent.status === "pending" ? "Awaiting acknowledgement" : null} onClick={()=>owner.discardIntent!(intent.id)}>Discard</Button>}</>,
  })), ...[...projected]
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
          {row.entry.receiptId &&
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
    }))];
  const list = useList({
    items: rows,
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
