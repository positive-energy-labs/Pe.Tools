/**
 * THE PATCH BAY (host MAP round 4, promoted 2026-10-12): documents are jacks on the left (the
 * master table with its filters), Revits are sockets on the right (one `SessionCard` each, plus a
 * free "new Revit" card), and every open document is a cable between them, all the time. Pea's
 * cables are dashed pea green. Patching a jack into a socket forces one `ArmingStrip` in that socket whose verb names
 * every consequence; pressing it is the consent (ADR 0016). The table's query box is the command
 * line: before `→` it filters the documents, after it, it addresses a socket and its options. Every
 * token equals a click and clicks update the chips: one draft, two inputs.
 *
 * Each option has one home (Q16): the filters band holds source, search and saved year; the act of
 * patching holds the target; the free card holds a new Revit's year, whose and add-ins; the cable
 * adapter holds detach (workshared only) and missing links; a patched cable holds
 * reload and close. Window and headless are not human options.
 *
 * Ownership comes from the host's `Machine` reading; Pea's job labels come from the thread list. The same component has three homes: `/open` side by
 * side (`layout="row"`), the machine drawer stacked, and the composer's open mode.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Plug, Square } from "lucide-react";
import {
  instancesActions,
  nativeProcessSchema,
  type HarnessThreadSummary,
  type Machine,
  type MachineSession,
} from "@pe/agent-contracts";

import { ArmingStrip } from "@pe/kit/lang/arming-strip";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { Button } from "@pe/kit/lang/button";
import { Connectors, type Connection } from "#/components/lang/connector";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Row } from "@pe/kit/lang/row";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { docKey, heldRowParts, SessionCard, type SessionDocument } from "#/components/lang/session";
import { Switcher } from "@pe/kit/lang/switcher";
import type { QueryCommand } from "@pe/kit/table/model";
import { queryWords, readClause, useTableState, visibleRows } from "@pe/kit/table/view";
import { ActionOutcome } from "#/actions/receipt";
import { useRouteDemo } from "#/route/activity";
import { keyOf, pidOf, processOf, selectionOf } from "#/machine/session";
import { demoRecents } from "#/machine/use-machine";
import { dirty, previousOf, useAction, useReading } from "#/readings";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

import { documentColumns, ModelTable } from "./documents";
import { factsOf, useLifecycle } from "./lifecycle";
import {
  accessOf,
  defaultYear,
  EMPTY_DRAFT,
  launchPlan,
  modelRows,
  pathRow,
  jobsOf,
  type PeaJob,
  type DocRow,
  type LaunchDraft,
  type LaunchPlan,
} from "./model";
import { BAY_THREADS } from "./seeds";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import { TooltipHint } from "@pe/kit/lang/tooltip";

/** Thread activity labels only; thread heads do not grant browser-computed access. */
export function useThreadSummaries(
  enabled: boolean,
  fixture: readonly HarnessThreadSummary[] | null,
) {
  const [threads, setThreads] = useState<readonly HarnessThreadSummary[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return harnessClient(resolveWorkbenchConfig().origin).summaries(setThreads, () => {});
  }, [enabled]);
  return enabled ? threads : fixture;
}

export type BayLayout = "row" | "stack";

/** After a verb: the action whose receipt the line follows, or the refusal that stopped it. */
type Outcome = { action: string } | { refused: string };

function OutcomeOf({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  return "action" in outcome ? (
    <ActionOutcome id={outcome.action} />
  ) : (
    <OutcomeLine kind="refused" label={outcome.refused} />
  );
}

/**
 * The bay's world beside a machine a shell already holds (the drawer, the composer): the SDK
 * recents as a Reading, the rows, and the thread list. A fixture draws its seed's recents and
 * the fixture threads and opens no transport.
 */
export function useBayReadings(machine: Machine | null, fixture: boolean) {
  const routeDemo = useRouteDemo();
  const demo = fixture ? routeDemo : null;
  const live = useReading<{ result?: { recents?: RecentDocument[] } }>(
    fixture ? null : { kind: "sdk", read: "recents" },
  );
  const recents = fixture
    ? demoRecents(demo ?? "").result.recents
    : (previousOf(live)?.result?.recents ?? []);
  const sessions = machine?.revit.sessions ?? null;
  const rows = useMemo(() => modelRows(sessions ?? [], recents), [sessions, recents]);
  const threads = useThreadSummaries(!fixture, fixture ? BAY_THREADS : null);
  return { rows, threads, loading: sessions === null };
}

export function PatchBay({
  machine,
  loading,
  rows,
  threads,
  fixture,
  layout,
  refusal: shellRefusal = null,
  onNote,
}: {
  machine: Machine | null;
  loading: boolean;
  rows: readonly DocRow[];
  /** The host's thread list (Pea's job labels); null until it answers. */
  threads: readonly HarnessThreadSummary[] | null;
  fixture: boolean;
  layout: BayLayout;
  /** The shell's own refusal (the host stopped answering): every verb refuses with it. */
  refusal?: string | null;
  /** Where a receipt or a refusal also lands (the route's page log). */
  onNote?: (label: string, detail: string, caution: boolean, receipt?: { id: string }) => void;
}) {
  const [draft, setDraft] = useState<LaunchDraft>(EMPTY_DRAFT);
  const [arrowed, setArrowed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [bay, setBay] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useTableState();
  const columns = useMemo(() => documentColumns(layout), [layout]);
  // A pasted path becomes a jack the table does not list, so it can be patched like any other.
  const allRows = useMemo(() => {
    const pasted = queryWords(state.query)
      .map(readClause)
      .flatMap((clause) => (clause.kind === "word" ? (pathRow(clause.word) ?? []) : []))
      .find((row) => !rows.some((each) => each.key.toLowerCase() === row.key.toLowerCase()));
    return pasted ? [...rows, pasted] : rows;
  }, [rows, state.query]);
  const visible = useMemo(() => visibleRows(allRows, columns, state), [allRows, columns, state]);
  const sessions = useMemo(
    () =>
      [...(machine?.revit.sessions ?? [])].sort(
        (a, b) => Number(a.whose === "pea") - Number(b.whose === "pea"),
      ),
    [machine],
  );
  const years = machine?.revit.years ?? [];
  // The jack in hand: the picked row, else, once the arrow is typed, the first row the query keeps.
  // Derived, never captured: a pasted "clinic -> new 2024" filters and arms in one event.
  const inHand: LaunchDraft =
    draft.doc === null && arrowed && visible[0] ? { ...draft, doc: visible[0].key } : draft;
  const plan = launchPlan(inHand, machine, allRows);
  const refusal = fixture ? "Fixture: nothing on this page reaches a host." : shellRefusal;
  const jobs = useMemo(() => jobsOf(threads, sessions), [threads, sessions]);

  const unplug = () => {
    setDraft(EMPTY_DRAFT);
    setArrowed(false);
  };
  const pick = (row: DocRow) =>
    setDraft((was) => ({ ...was, doc: was.doc === row.key ? null : row.key, year: null }));
  const patch = (key: string) =>
    setDraft((was) => ({ ...was, target: was.target === key ? null : key }));
  const patchNew = (year: number | null) =>
    setDraft((was) => ({ ...was, target: "new", year: year ?? was.year }));

  const launch = useAction(async () => {
    const planned = plan.launch;
    if (!planned) return;
    try {
      const receipt = await runSemanticAction(
        planned.key,
        instancesActions[planned.key].input.parse(planned.input),
        undefined,
        {},
        "",
        crypto.randomUUID(),
        30_000,
      );
      // The line follows the receipt; the page log keeps what the reply said.
      setOutcome({ action: receipt.id });
      onNote?.(`${planned.key} ${receipt.state}`, "receipt", receipt.state !== "succeeded", {
        id: receipt.id,
      });
      dirty({ kind: "machine" });
      unplug();
    } catch (caught) {
      setOutcome({ refused: `${planned.key} refused: ${String(caught)}` });
      onNote?.(`${planned.key} refused`, String(caught), true);
    }
  });
  const blocked = refusal ?? plan.refusal ?? plan.waiting;
  const commit = () => {
    if (!blocked && plan.launch) launch.mutate(undefined);
  };

  /* ── The command line: tokens and chips derive from the draft; a take is a click ─────────── */
  const socketLabels = useMemo(() => {
    const labels = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const session of sessions) {
      const base = `${session.whose === "pea" ? "pea " : ""}${session.row.year}`;
      seen.set(base, (seen.get(base) ?? 0) + 1);
    }
    const used = new Set<string>();
    for (const session of sessions) {
      const base = `${session.whose === "pea" ? "pea " : ""}${session.row.year}`;
      const label =
        (seen.get(base) ?? 0) > 1 || used.has(base)
          ? `${base} pid ${pidOf(session.row) ?? "?"}`
          : base;
      used.add(label);
      labels.set(keyOf(session), label);
    }
    return labels;
  }, [sessions]);
  const newYear = draft.year ?? plan.year ?? defaultYear(plan.doc, years);
  const command: QueryCommand = {
    armed: arrowed || draft.target !== null,
    onArmed: (next) => {
      setArrowed(next);
      if (!next) unplug();
    },
    chips: [
      ...(draft.target && draft.target !== "new"
        ? [
            {
              key: "target",
              label: socketLabels.get(draft.target) ?? draft.target,
              title: "the Revit the document opens in; remove it to unpatch",
              onRemove: () => patch(draft.target!),
            },
          ]
        : []),
      ...(draft.target === "new"
        ? [
            {
              key: "new",
              label: `new ${newYear ?? ""}`.trim(),
              title: "a new Revit of this year starts when you press the verb",
              onRemove: () => setDraft((was) => ({ ...was, target: null, year: null })),
            },
            ...(draft.owner === "pea"
              ? [
                  {
                    key: "pea",
                    label: "pea",
                    title: "the new Revit is Pea's: background, a copy of the document",
                    onRemove: () => setDraft((was) => ({ ...was, owner: "you" })),
                  },
                ]
              : []),
            ...(draft.addins === "off"
              ? [
                  {
                    key: "addins",
                    label: "no addins",
                    title: "third-party add-ins stay off in the new Revit",
                    onRemove: () => setDraft((was) => ({ ...was, addins: "on" })),
                  },
                ]
              : []),
          ]
        : []),
      ...(draft.detach
        ? [
            {
              key: "detach",
              label: "detach",
              title: "the cable adapter: open detached from central",
              onRemove: () => setDraft((was) => ({ ...was, detach: false })),
            },
          ]
        : []),
      ...(draft.links === "allow"
        ? [
            {
              key: "links",
              label: "links allow",
              title: "open even when a linked model is missing",
              onRemove: () => setDraft((was) => ({ ...was, links: "refuse" })),
            },
          ]
        : []),
    ],
    tokens: (typed) => {
      const out: { key: string; label: string; hint?: string; take: () => void }[] = [];
      if (!draft.target) {
        for (const session of sessions)
          out.push({
            key: keyOf(session),
            label: socketLabels.get(keyOf(session))!,
            hint: `${session.whose === "pea" ? "Pea's" : "your"} Revit · pid ${pidOf(session.row) ?? "?"}`,
            take: () => patch(keyOf(session)),
          });
        out.push({
          key: "new",
          label: "new",
          hint: `a new Revit ${newYear ?? ""}`.trim(),
          take: () => patchNew(null),
        });
        for (const year of years)
          out.push({
            key: `new ${year}`,
            label: `new ${year}`,
            hint: "start one",
            take: () => patchNew(year),
          });
      } else if (draft.target === "new") {
        for (const year of years)
          out.push({
            key: String(year),
            label: String(year),
            hint: "the new Revit's year",
            take: () => setDraft((was) => ({ ...was, year })),
          });
        out.push(
          {
            key: "pea",
            label: "pea",
            hint: "Pea's background Revit",
            take: () => setDraft((was) => ({ ...was, owner: "pea" })),
          },
          {
            key: "yours",
            label: "yours",
            hint: "your own Revit",
            take: () => setDraft((was) => ({ ...was, owner: "you" })),
          },
          {
            key: "no addins",
            label: "no addins",
            hint: "third-party add-ins off",
            take: () => setDraft((was) => ({ ...was, addins: "off" })),
          },
          {
            key: "addins on",
            label: "addins on",
            hint: "every add-in loads",
            take: () => setDraft((was) => ({ ...was, addins: "on" })),
          },
        );
      }
      if (draft.target)
        out.push(
          {
            key: "detach",
            label: "detach",
            hint: "the cable adapter",
            take: () => setDraft((was) => ({ ...was, detach: true })),
          },
          {
            key: "attached",
            label: "attached",
            hint: "keep central",
            take: () => setDraft((was) => ({ ...was, detach: false })),
          },
          {
            key: "links allow",
            label: "links allow",
            hint: "open without missing links",
            take: () => setDraft((was) => ({ ...was, links: "allow" })),
          },
          {
            key: "links refuse",
            label: "links refuse",
            hint: "refuse when a link is missing",
            take: () => setDraft((was) => ({ ...was, links: "refuse" })),
          },
        );
      return out.filter((token) => token.label.toLowerCase().startsWith(typed));
    },
    onCommit: commit,
    says: "Enter presses the verb: open the picked document in the named Revit",
    placeholder: draft.target
      ? "detach · links allow · pea · no addins"
      : "2025 · pea 2025 · new 2024 · detach",
  };

  /* ── Cables ────────────────────────────────────────────────────────────────────────────── */
  const yy = (year: number) => String(year).slice(2);
  const links: Connection[] = [];
  for (const session of sessions)
    for (const document of session.documents ?? []) {
      const row = allRows.find((each) => each.openIn?.document === document);
      if (!row || !document.openId) continue;
      const openId = document.openId;
      const pea = session.whose === "pea";
      const upgrade =
        row.savedYear && row.savedYear < session.row.year
          ? `${yy(row.savedYear)}→${yy(session.row.year)}`
          : null;
      links.push({
        key: `cable:${openId}`,
        from: [row.key, "jacks"],
        to: docKey(document),
        tone: pea ? "pea" : undefined,
        dashed: pea,
        label: upgrade ? (
          <TooltipHint content={`opened in a newer Revit than it was saved in`}>
            <span data-tone="caution">{upgrade}</span>
          </TooltipHint>
        ) : undefined,
        title: pea
          ? `Pea's copy of ${row.title}`
          : `${row.title} is open in Revit ${session.row.year}; press for its verbs`,
        onClick: () => setHeld(held === openId ? null : openId),
      });
    }
  const aim = draft.target ?? hover;
  if (plan.doc && aim)
    links.push({
      key: "pending",
      from: [plan.doc.key, "jacks"],
      to: `free:${aim}`,
      dashed: true,
      tone: draft.target ? (plan.refusal ? "alarm" : "commit") : undefined,
      title: plan.verb,
    });

  /* ── The sockets ───────────────────────────────────────────────────────────────────────── */
  const saved = plan.doc?.savedYear ?? null;
  const strip = (
    <LaunchStrip
      plan={plan}
      draft={draft}
      setDraft={setDraft}
      blocked={blocked}
      busy={launch.isPending}
      onCommit={commit}
      onCancel={unplug}
    />
  );
  const newOwner = draft.owner;
  const sockets = (
    <div
      className={
        layout === "row"
          ? "flex min-h-0 flex-col gap-2 overflow-y-auto pb-2"
          : "flex flex-col gap-2 pr-6"
      }
      aria-label="Revits on this machine"
    >
      {machine && machine.revit.sessions === null ? (
        <OutcomeLine kind="error" label="the Revit census has not been read" />
      ) : null}
      {sessions.map((session) => {
        const key = keyOf(session);
        const refuse =
          saved !== null && session.row.year < saved
            ? `Revit ${session.row.year} cannot open a ${saved} file`
            : null;
        return (
          <Socket
            key={key}
            session={session}
            refusal={refusal}
            hr={layout === "row"}
            doc={plan.doc}
            refuse={refuse}
            patched={draft.target === key}
            onPatch={() => patch(key)}
            onHover={(over) => setHover(over ? key : null)}
            strip={draft.target === key ? strip : null}
            jobs={jobs.filter((job) => job.session === session)}
            held={held}
            onHeld={setHeld}
          />
        );
      })}
      <ArtifactFrame
        data-key="socket:new"
        label="new Revit"
        head={
          <>
            <span className="t-small t-upper" data-tone={newOwner === "pea" ? "pea" : undefined}>
              {newOwner === "pea" ? "Pea's new background Revit" : "your new Revit"} {newYear ?? ""}
            </span>
            <span className="text-ink-2">starts when patched</span>
          </>
        }
      >
        <div className="flex flex-col py-1">
          <FreeSocket
            anchor="free:new"
            doc={plan.doc}
            refuse={
              saved !== null && years.length && saved > Math.max(...years)
                ? `no installed Revit is new enough for a ${saved} file`
                : null
            }
            patched={draft.target === "new"}
            onPatch={() => patchNew(null)}
            onHover={(over) => setHover(over ? "new" : null)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 px-(--gutter) pb-1 hairline-t pt-1">
          <Switcher
            ariaLabel="new Revit year"
            value={newYear === null ? "" : String(newYear)}
            onChange={(year) => patchNew(Number(year))}
            options={years.map((year) => ({
              value: String(year),
              label: <span className="face-mono">{year}</span>,
              title:
                saved !== null && year < saved
                  ? `Revit ${year} cannot open a ${saved} file`
                  : `start Revit ${year}`,
              disabled: saved !== null && year < saved,
            }))}
          />
          <Switcher
            ariaLabel="whose"
            value={newOwner}
            onChange={(owner) => setDraft((was) => ({ ...was, owner, target: "new" }))}
            options={[
              { value: "you", label: "yours", title: "a Revit window of your own" },
              {
                value: "pea",
                label: <span data-tone="pea">Pea's</span>,
                title: "Pea's background Revit; it works on a copy of the document",
              },
            ]}
          />
          <Switcher
            ariaLabel="add-ins"
            value={draft.addins}
            onChange={(addins) => setDraft((was) => ({ ...was, addins, target: "new" }))}
            options={[
              { value: "on", label: "add-ins", title: "load every add-in" },
              { value: "off", label: "off", title: "third-party add-ins off for this Revit" },
            ]}
          />
        </div>
        {draft.target === "new" ? strip : null}
      </ArtifactFrame>
      <OutcomeOf outcome={outcome} />
    </div>
  );

  const table = (
    <div
      data-key="jacks"
      className={
        layout === "row"
          ? "flex min-h-0 min-w-0 flex-col"
          : "flex max-h-72 min-w-0 shrink-0 flex-col pr-6 [&_table]:table-fixed [&_[data-slot=table-filters]]:gap-y-1 [&_[data-slot=query-box]]:basis-full [&_[data-slot=query-box]]:flex-none [&_[role=group]]:max-w-full [&_[role=group]]:flex-wrap"
      }
    >
      <ModelTable
        rows={allRows}
        columns={columns}
        state={state}
        onStateChange={setState}
        picked={plan.doc?.key ?? null}
        onPick={pick}
        loading={loading}
        command={command}
      />
      {plan.doc && !draft.target ? (
        <OutcomeLine
          kind={plan.refusal ? "refused" : "advisory"}
          label={plan.refusal ?? `${plan.doc.title}: ${plan.waiting}`}
        />
      ) : null}
    </div>
  );

  return (
    <div
      ref={setBay}
      data-testid="patch-bay"
      data-layout={layout}
      className={
        layout === "row"
          ? "relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_7rem_minmax(18rem,22rem)]"
          : "relative flex min-w-0 flex-col gap-2"
      }
    >
      {table}
      {layout === "row" ? <span aria-hidden /> : null}
      {sockets}
      {!sessions.length && !loading ? (
        <div className="absolute inset-x-0 bottom-0">
          <EmptyState story="scope" exit="patch a document into the free socket to start one">
            no Revit is running
          </EmptyState>
        </div>
      ) : null}
      <Connectors
        container={bay}
        links={links}
        layout={layout}
        inset={(scroller) => ({
          top: scroller.querySelector("thead")?.getBoundingClientRect().height ?? 0,
        })}
      />
    </div>
  );
}

/** The forced action, hung in the socket the jack was patched into. */
function LaunchStrip({
  plan,
  draft,
  setDraft,
  blocked,
  busy,
  onCommit,
  onCancel,
}: {
  plan: LaunchPlan;
  draft: LaunchDraft;
  setDraft: (next: (was: LaunchDraft) => LaunchDraft) => void;
  blocked: string | null;
  busy: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const doc = plan.doc;
  const workshared =
    doc?.cloud === true ||
    (doc?.openIn?.document !== undefined &&
      "isWorkshared" in doc.openIn.document &&
      doc.openIn.document.isWorkshared === true);
  return (
    <ArmingStrip
      verb={plan.verb}
      target={doc?.title ?? "no document"}
      icon={Plug}
      says={
        <>
          {plan.cautions.map((caution) => (
            <span
              key={caution.text}
              data-tone={caution.tone === "commit" ? undefined : caution.tone}
            >
              {caution.text}{" "}
            </span>
          ))}
          <TooltipHint content="what the host runs">
            <span className="block face-mono" data-argv>
              {plan.argv.join("  then  ")}
            </span>
          </TooltipHint>
        </>
      }
      state={{ phase: "arming" }}
      busy={busy}
      refusal={blocked}
      onCommit={onCommit}
      onCancel={onCancel}
      alternatives={
        doc ? (
          <>
            {workshared && plan.whose === "you" ? (
              <Switcher
                ariaLabel="central"
                value={draft.detach ? "detached" : "attached"}
                onChange={(value) => setDraft((was) => ({ ...was, detach: value === "detached" }))}
                options={[
                  { value: "attached", label: "attached", title: "edits sync to central" },
                  {
                    value: "detached",
                    label: "detached",
                    title: "the cable adapter: open detached, worksets preserved; edits never sync",
                  },
                ]}
              />
            ) : null}
            <Switcher
              ariaLabel="missing linked files"
              value={draft.links}
              onChange={(links) => setDraft((was) => ({ ...was, links }))}
              options={[
                {
                  value: "refuse",
                  label: "links: refuse",
                  title: "refuse to open if a linked file is missing",
                },
                {
                  value: "allow",
                  label: "links: allow",
                  title: "open without missing links; the receipt names them",
                },
              ]}
            />
          </>
        ) : null
      }
    />
  );
}

/** The empty hole on a card: the row a jack is patched into. */
function FreeSocket({
  anchor,
  doc,
  refuse,
  patched,
  onPatch,
  onHover,
}: {
  anchor: string;
  doc: DocRow | null;
  refuse: string | null;
  patched: boolean;
  onPatch: () => void;
  onHover: (over: boolean) => void;
}) {
  return (
    <Row
      data-key={anchor}
      lead={<Plug className="size-3" aria-hidden />}
      label={
        refuse
          ? `refuses ${doc?.title ?? "this file"}`
          : doc
            ? `patch ${doc.title} here`
            : "patch a document here"
      }
      refusal={refuse}
      selected={patched}
      title={
        refuse ??
        (doc
          ? "press to patch the picked document into this Revit"
          : "pick a document on the left first")
      }
      onClick={onPatch}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    />
  );
}

/** One running Revit as a socket: its documents, its free hole, Pea's job, the strips. */
function Socket({
  session,
  refusal,
  hr,
  doc,
  refuse,
  patched,
  onPatch,
  onHover,
  strip,
  jobs,
  held,
  onHeld,
}: {
  session: MachineSession;
  refusal: string | null;
  /** Whether hr is offered here (the wide bay; the drawer keeps it off). */
  hr: boolean;
  doc: DocRow | null;
  refuse: string | null;
  patched: boolean;
  onPatch: () => void;
  onHover: (over: boolean) => void;
  strip: ReactNode;
  jobs: readonly PeaJob[];
  held: string | null;
  onHeld: (openId: string | null) => void;
}) {
  const { verbs, strip: lifecycle } = useLifecycle({ session, refusal, hr });
  const pea = session.whose === "pea";
  const facts = { ...factsOf(session), ...(pea ? { whose: "pea" as const } : {}) };
  return (
    <SessionCard
      session={session}
      facts={facts}
      anchor={keyOf(session)}
      verbs={verbs}
      strip={
        <>
          {lifecycle}
          {strip}
        </>
      }
      documentParts={(document) => heldRowParts(document, accessOf(session, document))}
      selectedDocument={held ? `doc:${held}` : null}
      onDocumentPick={(document) => onHeld(document?.openId ?? document?.path ?? null)}
      documentDetail={(document) => (
        <CableControls session={session} document={document} refusal={refusal} />
      )}
    >
      <FreeSocket
        anchor={`free:${keyOf(session)}`}
        doc={doc}
        refuse={refuse}
        patched={patched}
        onPatch={onPatch}
        onHover={onHover}
      />
      <JobList jobs={jobs} />
    </SessionCard>
  );
}

function JobList({ jobs }: { jobs: readonly PeaJob[] }) {
  const list = useList({
    items: jobs,
    keyOf: (job) => job.thread.id,
    search: (job) => ({
      text: [job.thread.title, job.thread.activity.state, job.thread.activity.message],
    }),
  });
  if (!jobs.length) return null;
  return (
    <ListView
      list={list}
      aria-label="Pea jobs"
      bar={false}
      empty={{ message: "No Pea jobs", exit: "Ask Pea to work in this Revit" }}
      row={(job) => ({
        lines: 2,
        label: <span data-tone="pea">{job.thread.title}</span>,
        meta: (
          <span data-tone={job.thread.activity.state === "failed" ? "alarm" : undefined}>
            {job.thread.activity.state === "running" ? "working" : job.thread.activity.state}
          </span>
        ),
        sub: job.thread.activity.message ?? "no activity reported",
        title: "Pea's job in this Revit: the thread, its state, its latest activity",
      })}
    />
  );
}

/** A held document's controls, inside its standard list row's detail. */
function CableControls({
  session,
  document,
  refusal,
}: {
  session: MachineSession;
  document: SessionDocument;
  refusal: string | null;
}) {
  const [armed, setArmed] = useState<"close" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const process = processOf(session.row);
  const blocked =
    refusal ??
    (process ? null : "This Revit has no process yet; wait until it is launched.") ??
    (document.openId ? null : "This document has no openId yet.");
  const cloud =
    document.persistence === "cloud" ||
    ("isWorkshared" in document && document.isWorkshared === true);
  const action = useAction(
    async (verb: { kind: "close"; unsaved: "keep" | "discard" } | { kind: "reload" }) => {
      try {
        const selection = selectionOf(session.row);
        const key = verb.kind === "close" ? "instances.close" : "instances.open";
        const input =
          verb.kind === "close"
            ? instancesActions["instances.close"].input.parse({
                session: { selection, process: nativeProcessSchema.parse(process) },
                document: { source: "sdk", session: selection, openId: document.openId },
                unsaved: verb.unsaved,
              })
            : instancesActions["instances.open"].input.parse({
                source: document.openId,
                into: { session: selection },
                reload: true,
              });
        const receipt = await runSemanticAction(
          key,
          input,
          undefined,
          {},
          "",
          crypto.randomUUID(),
          30_000,
        );
        setOutcome({ action: receipt.id });
        dirty({ kind: "machine" });
      } catch (caught) {
        setOutcome({ refused: `${verb.kind} refused: ${String(caught)}` });
      } finally {
        setArmed(null);
      }
    },
  );
  const busy = action.isPending;
  const gate = (says: string) => ({ reason: blocked ?? says, refusal: blocked });
  const title = document.title ?? document.path ?? "document";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {cloud ? (
          <Button
            label="reload"
            kind="framed"
            busy={busy}
            {...gate(
              `pe-revit doc open ${document.openId} --reload: reload the latest central changes into it`,
            )}
            onClick={() => action.mutate({ kind: "reload" })}
          >
            reload
          </Button>
        ) : null}
        <Button
          label="close"
          kind="framed"
          pressed={armed === "close"}
          {...gate(`pe-revit doc close ${document.openId}`)}
          onClick={() => setArmed(armed === "close" ? null : "close")}
        >
          close
        </Button>
      </div>
      {armed === "close" ? (
        <ArmingStrip
          verb="close, keep work"
          target={title}
          icon={Square}
          says={
            document.isModified
              ? "It has unsaved work: closing saves it first."
              : "Nothing is unsaved."
          }
          state={{ phase: "arming" }}
          busy={busy}
          refusal={blocked}
          onCommit={() => action.mutate({ kind: "close", unsaved: "keep" })}
          onCancel={() => setArmed(null)}
          alternatives={
            <Button
              label="close, discard edits"
              kind="framed"
              {...gate(`pe-revit doc close ${document.openId} --unsaved discard`)}
              onClick={() => action.mutate({ kind: "close", unsaved: "discard" })}
            >
              close, discard edits
            </Button>
          }
        />
      ) : null}
      <OutcomeOf outcome={outcome} />
    </div>
  );
}
