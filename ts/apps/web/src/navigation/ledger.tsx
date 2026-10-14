/**
 * The open-work ledger, drawn once. `useLedgerList` turns the host's rows and one presentation
 * record into the kit List's props; `<Ledger>` draws them inline (Home's column, the tray Inbox)
 * and the Ctrl+Shift+K overlay spreads the same props into the anchored palette.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { List } from "@pe/kit/lang/list-popup";
import { Button } from "@pe/kit/lang/button";
import type { HarnessThreadSummary } from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { useMachine } from "#/machine/use-machine";
import { attention, machineOf } from "#/machine/model";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { relativeThreadAge } from "#/chat/thread-navigation";
import {
  destinationDetail,
  destinationLabel,
  globalItems,
  type Destination,
  type ResultKind,
} from "./global-items";
import { resumeRefusal } from "./model";
import { useDestination, useNavigation } from "./state";
import {
  GROUP_NAME,
  LEDGER_GROUPS,
  ledgerRows,
  openAsk,
  presentLedger,
  type LedgerGroup,
  type LedgerItem,
  type LedgerPresentation,
  type LedgerRow,
  type LedgerSources,
} from "./ledger-model";

const TONE: Partial<Record<string, "caution" | "alarm">> = {
  asks: "caution",
  approve: "caution",
  review: "caution",
  unknown: "caution",
  incomplete: "caution",
  machine: "caution",
  interrupted: "caution",
  failed: "alarm",
};
/** Open work stays above tools, Works and threads while a query ranks them. */
const LEADING_GROUPS = LEDGER_GROUPS.map((group) => GROUP_NAME[group]);

/** The host's open work, live: thread summaries stream; receipts are read. */
function useLedgerRows() {
  const [threads, setThreads] = useState<HarnessThreadSummary[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [asks, setAsks] = useState<LedgerSources["asks"]>(new Map());
  const [receipts, setReceipts] = useState<LedgerSources["receipts"]>([]);
  const { snapshot } = useNavigation();
  const machine = machineOf(useMachine().reading);
  const asked = useRef(new Map<string, number>());
  useEffect(
    () =>
      harnessClient(resolveWorkbenchConfig().origin).summaries(
        (next) => {
          setThreads(next);
          setFault(null);
        },
        (error) => setFault(error.message),
      ),
    [],
  );
  useEffect(() => {
    // ponytail: receipts are read on focus and every 15 s; a receipts stream (wave B) replaces this.
    const read = () =>
      void peClient
        .call("actions.read", {})
        .then((value) =>
          setReceipts(Array.isArray(value) ? (value as LedgerSources["receipts"]) : []),
        )
        .catch(() => {});
    read();
    const timer = setInterval(read, 15_000);
    window.addEventListener("focus", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, []);
  // A waiting thread's ask is read from its log once per change of its last seq.
  useEffect(() => {
    for (const thread of threads ?? []) {
      const waiting = thread.activity.state === "waiting" || thread.activity.pending > 0;
      if (!waiting || asked.current.get(thread.id) === thread.lastSeq) continue;
      asked.current.set(thread.id, thread.lastSeq);
      void peClient
        .call("thread.get", { params: { id: thread.id } })
        .then((body) => {
          const ask = openAsk(body.events);
          if (ask) setAsks((prior) => new Map(prior).set(thread.id, ask));
        })
        .catch(() => {});
    }
  }, [threads]);
  const attentionLines = machine ? attention(machine) : [];
  const rows = useMemo(
    () =>
      ledgerRows(
        {
          threads: threads ?? [],
          asks,
          receipts,
          works: snapshot?.works ?? [],
          attention: attentionLines,
        },
        Date.now(),
      ),
    [threads, asks, receipts, snapshot, attentionLines.join("\n")],
  );
  return {
    rows,
    status: threads ? ("ready" as const) : fault ? ("failed" as const) : ("pending" as const),
    fault,
  };
}

/** A host-restart death re-sends the turn the restart cut off, then opens the thread. */
export async function resumeThread(id: string) {
  const body = await peClient.call("thread.get", { params: { id } });
  const turn = [...body.events].reverse().find((event) => event.kind === "prompt");
  if (turn?.kind !== "prompt") throw new Error("This thread has no turn to resume.");
  // A resumed turn is a new prompt: it gets its own id, like every composer send.
  await peClient.call("thread.prompt", {
    params: { id },
    body: {
      id: crypto.randomUUID(),
      text: turn.text,
      attachments: turn.attachments,
      mentions: turn.mentions,
    },
  });
}

type Item = LedgerItem | { kind: "go"; key: string; destination: Destination };

/** The kit List's props for one presentation; the overlay passes its field as owner and query. */
export function useLedgerList(
  presentation: LedgerPresentation,
  query = "",
  kind: ResultKind = "All",
) {
  const { rows, status, fault } = useLedgerRows();
  const { snapshot, loading, error } = useNavigation();
  const go = useDestination();
  const [open, setOpen] = useState<ReadonlySet<LedgerGroup>>(new Set());
  const [resuming, setResuming] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const searching = query.trim() !== "";
  const items: Item[] = [
    ...(kind === "All"
      ? presentLedger(rows, presentation, searching ? new Set(LEDGER_GROUPS) : open)
      : []),
    ...(presentation.destinations && (searching || kind !== "All")
      ? globalItems(snapshot, kind).map((destination) => ({
          kind: "go" as const,
          key: `go:${destination.key}`,
          destination,
        }))
      : []),
  ];
  const resume = (row: LedgerRow) => {
    setResuming(row.resume!);
    resumeThread(row.resume!)
      .then(() => go(row.url!))
      .catch((cause: unknown) => setRefusal(String(cause)))
      .finally(() => setResuming(null));
  };
  /** One row shape for ledger rows, destinations and notes: verb column, what, where, fact. */
  const row = (item: Item) => {
    if (item.kind === "note")
      return {
        lead: <span className="inline-block w-[11ch]" />,
        label: <span className="text-ink-2">{item.text}</span>,
        refusal: item.count ? undefined : "Nothing to open",
      };
    const shown =
      item.kind === "go"
        ? {
            verb: "go to",
            what: item.destination.label,
            where: item.destination.context,
            fact: item.destination.state,
            says: null,
            refusal: resumeRefusal(
              item.destination,
              item.destination.kind === "Works" && !!(loading || error),
            ),
          }
        : { ...item.row, fact: item.row.at ? relativeThreadAge(item.row.at) : "" };
    return {
      lead: (
        <span className="inline-block w-[11ch] face-mono" data-tone={TONE[shown.verb]}>
          {shown.verb}
        </span>
      ),
      label: shown.what,
      aside: shown.where,
      meta: <span className="face-mono tabular-nums">{shown.fact}</span>,
      ...(presentation.says && shown.says ? { lines: 2 as const, sub: shown.says } : {}),
      refusal: shown.refusal,
      actions:
        item.kind === "row" && item.row.resume ? (
          <Button
            label={`Resume ${item.row.what}: re-send the turn the host restart cut off`}
            icon={RotateCcw}
            busy={resuming === item.row.resume}
            onClick={() => resume(item.row)}
          />
        ) : undefined,
    };
  };
  return {
    rows,
    refusal,
    props: {
      "aria-label": presentation.label,
      items,
      keyOf: (item: Item) => item.key,
      // Name first, then the rest at word starts (kit `words` mode with `detailOf`).
      labelOf: (item: Item) =>
        item.kind === "go"
          ? destinationLabel(item.destination)
          : item.kind === "row"
            ? item.row.what
            : "",
      detailOf: (item: Item) =>
        item.kind === "go"
          ? destinationDetail(item.destination)
          : item.kind === "row"
            ? `${item.row.verb} ${item.row.where} ${item.row.says ?? ""}`
            : "",
      groupOf: (item: Item) =>
        item.kind === "go"
          ? item.destination.kind
          : GROUP_NAME[item.kind === "row" ? item.row.group : item.group],
      leadingGroups: LEADING_GROUPS,
      groupCounts: false as const,
      filter: searching ? ("words" as const) : ("none" as const),
      query,
      status,
      failure: fault ?? undefined,
      empty: "Nothing open: no thread waits, works, failed or is unread",
      noMatch: "No matching open work, tools, Works or Pea threads",
      row,
      onPick: (item: Item) => {
        if (item.kind === "note") setOpen((prior) => new Set(prior).add(item.group));
        else if (item.kind === "row" && item.row.url) go(item.row.url);
        else if (item.kind === "go" && item.destination.url) go(item.destination.url);
      },
    },
  };
}

/** The tray's counter strip: one count per group, waits and working first. */
function Counters({ rows }: { rows: readonly LedgerRow[] }) {
  return (
    <dl className="m-0 flex hairline-b" aria-label="Open work by group">
      {LEDGER_GROUPS.map((group) => {
        const count = rows.filter((row) => row.group === group).length;
        return (
          <div key={group} className="flex min-w-0 flex-1 flex-col-reverse px-2 py-1 hairline-r">
            <dt className="t-small text-ink-2">{GROUP_NAME[group]}</dt>
            <dd
              className="m-0 t-display face-mono tabular-nums"
              data-tone={count ? TONE[group === "waits" ? "asks" : group] : undefined}
            >
              {count}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The ledger drawn inline: Home's column and the tray Inbox. */
export function Ledger({
  presentation,
  head,
}: {
  presentation: LedgerPresentation;
  head?: ReactNode;
}) {
  const ledger = useLedgerList(presentation);
  return (
    <section
      aria-label={presentation.label}
      data-ledger={presentation.id}
      className="flex min-h-0 flex-col"
    >
      {head}
      {presentation.counters && <Counters rows={ledger.rows} />}
      {ledger.refusal && <p className="m-0 px-2 py-1 text-ink-2">{ledger.refusal}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        <List {...ledger.props} />
      </div>
    </section>
  );
}
