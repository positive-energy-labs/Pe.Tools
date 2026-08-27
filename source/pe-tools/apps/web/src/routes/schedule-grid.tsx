import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  type ScheduleGridDocument,
  scheduleCellKey,
  scheduleGridRouteState,
  splitScheduleCellKey,
} from "@pe/agent-contracts";

import { AddressingBar } from "#/components/lang/addressing-bar";
import type { StateCellProps } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { ValueDiff } from "#/components/ui/value-diff";
import { useVerb } from "#/lib/use-verb";
import { timeAgo } from "#/lib/utils";
import { useRouteState } from "#/workbench/route-state";

/**
 * /schedule-grid — a web surface for editing any Revit schedule collaboratively. The rail
 * (SidePane + PickList) lists every schedule in the document; filter + ↑/↓ + Enter opens one
 * into the grid with cell binding handles. pea proposes cell values; the engineer reviews in
 * the grid or the pending-changes strip, stages, and pushes back to Revit. All state lives in
 * the route-state document, written through the dispatcher as `actor:"human"`. Cells carry a
 * proposal → staged → pushed trichotomy; only the human can push.
 *
 * Design-language pass 2026-08-16: the grid is `MasterTable` with one `state:` column per
 * schedule column — proposal wash, unsaved square, squiggles and the readout band all come from
 * the cell grammar; editing rides `StateCell.onCommit` (typing a proposed cell severs the
 * proposal — §3 "typing beats proposing"). In-cell approve/deny icons died with the hand-rolled
 * table; the pending strip is the reviewer.
 */
export const Route = createFileRoute("/schedule-grid")({
  component: ScheduleGridRoute,
});

type CellState = NonNullable<ScheduleGridDocument["cells"][string]>;
type Snapshot = NonNullable<ScheduleGridDocument["snapshot"]>;
type ScheduleRow = Snapshot["rows"][number];

function ScheduleGridRoute() {
  const { slice, hydrated, apply, command, peaActive, connected } =
    useRouteState(scheduleGridRouteState);
  const document = slice;
  const snapshot = document?.snapshot ?? null;
  const catalog = document?.catalog ?? null;
  const cells = document?.cells ?? {};

  const verb = useVerb();
  const [partial, setPartial] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<string | null>(null);

  const staged = Object.entries(cells).filter(([, cell]) => cell.staged != null);
  const stagedCount = staged.length;
  const attention = staged.filter(([, cell]) => cell.review === "attention").length;
  const proposalCount = Object.values(cells).filter(
    (cell) => cell.proposal != null && cell.staged == null,
  ).length;
  const pending = Object.entries(cells).filter(
    ([, cell]) => cell.proposal != null || cell.staged != null,
  );
  const pushable = stagedCount > 0 && attention === 0;

  /** One in-flight command; a push's per-cell failures surface as a `partial` outcome —
   * the failed cells stay staged, which is exactly what the caution kind says. */
  const runCommand = (
    label: string,
    kind: "catalog" | "refresh" | "push",
    input: Record<string, unknown> = {},
    receipt?: string,
  ) =>
    void verb.run(label, async () => {
      setPartial(null);
      const result = await command(kind, input);
      if (!result.ok) throw new Error(result.error ?? result.hint ?? `${label} failed.`);
      const failureNote = pushFailureNote(result.result);
      if (failureNote != null) {
        setPartial(failureNote);
        return;
      }
      return receipt;
    });

  const stageValue = (key: string, value: string) =>
    void apply([
      { path: ["cells", key, "staged"], value: { value } },
      { path: ["cells", key, "review"], value: "good" },
    ]);
  /** Typing beats proposing (§3): a user edit severs an open proposal outright. */
  const stageEdit = (key: string, value: string): string | void => {
    if (value.length === 0)
      return "an empty value cannot be staged — type a value, or leave the cell as it was";
    const patches: { path: (string | number)[]; value?: unknown }[] = [
      { path: ["cells", key, "staged"], value: { value } },
      { path: ["cells", key, "review"], value: "good" },
    ];
    if (cells[key]?.proposal != null) patches.push({ path: ["cells", key, "proposal"] });
    void apply(patches);
  };
  const deny = (key: string) =>
    void apply([
      { path: ["cells", key, "proposal"] },
      { path: ["cells", key, "review"], value: "none" },
    ]);
  const undo = (key: string) =>
    void apply([
      { path: ["cells", key, "staged"] },
      { path: ["cells", key, "review"], value: "none" },
    ]);

  const columnHeader = (columnNumber: number) =>
    snapshot?.columns.find((column) => column.columnNumber === columnNumber)?.headerText ??
    `col ${columnNumber}`;
  const currentText = (key: string) => {
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const row = snapshot?.rows.find((candidate) => candidate.rowNumber === rowNumber);
    const columnIndex =
      snapshot?.columns.findIndex((column) => column.columnNumber === columnNumber) ?? -1;
    const binding = row?.bindings.find((candidate) => candidate.columnNumber === columnNumber);
    return binding?.displayValue ?? (columnIndex >= 0 ? (row?.values[columnIndex] ?? null) : null);
  };

  /** THE CELL-STATE CLAUSE: one `state:` column per schedule column. The grammar draws the
   * proposal wash, the unsaved square and the locked body; prose facts (binding, blocker,
   * pea's note, "needs review") ride the note and read out in the band under the table. */
  const gridColumns = useMemo<Column<ScheduleRow>[]>(() => {
    if (!snapshot) return [];
    return [
      {
        key: "row",
        label: "#",
        title: "Schedule row number. ×N marks a grouped row standing for N elements.",
        right: true,
        width: "w-12",
        lock: true,
        sort: (row) => row.rowNumber,
        cell: (row) => (
          <span
            className="face-mono t-caption block truncate px-1.5 text-right text-ink-2"
            title={`row ${row.rowNumber} · ${row.kind}${row.subjectIds.length > 0 ? ` · elements [${row.subjectIds.join(",")}]` : ""}`}
          >
            {row.rowNumber}
            {row.subjectIds.length > 1 ? ` ×${row.subjectIds.length}` : ""}
          </span>
        ),
      },
      ...snapshot.columns.map((column): Column<ScheduleRow> => {
        const columnIndex = snapshot.columns.findIndex(
          (candidate) => candidate.columnNumber === column.columnNumber,
        );
        const kindNote = [
          column.isCalculated ? "ƒ calculated — Revit derives it; never writable" : null,
          column.isCombinedParameter
            ? "combined parameter — several parameters in one column"
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          key: `c${column.columnNumber}`,
          label: column.headerText || `col ${column.columnNumber}`,
          header:
            column.isCalculated || column.isCombinedParameter
              ? `${column.headerText} · ${column.isCalculated ? "ƒ" : "comb"}`
              : undefined,
          title: kindNote || "Schedule column — values write through the cell's parameter binding.",
          search: (row) => row.values[columnIndex] ?? "",
          state: (row): StateCellProps => {
            const key = scheduleCellKey(row.rowNumber, column.columnNumber);
            const binding = row.bindings.find(
              (candidate) => candidate.columnNumber === column.columnNumber,
            );
            const cell = cells[key];
            const isStaged = cell?.staged != null;
            const isProposal = !isStaged && cell?.proposal != null;
            const current = binding?.displayValue ?? row.values[columnIndex] ?? "";
            const shown = isStaged
              ? (cell?.staged?.value ?? "")
              : isProposal
                ? String(cell?.proposal?.value ?? "")
                : current;
            const editable = binding?.isEditable === true && binding.blocker === "None";
            const capReason =
              binding == null
                ? "no parameter behind this cell — the row is unbound here"
                : editable
                  ? undefined
                  : binding.blocker !== "None"
                    ? `blocked: ${binding.blocker}`
                    : "read-only — this parameter cannot be written from a schedule";
            const note =
              [
                cell?.review === "attention"
                  ? "needs review — flagged; push refuses while it stands"
                  : null,
                (isStaged || isProposal) && shown !== current ? `was ${current || "—"}` : null,
                isProposal
                  ? cell?.proposal?.note
                    ? `pea: ${cell.proposal.note}`
                    : "pea proposed this"
                  : null,
                binding?.isTypeParameter
                  ? "type parameter — shared across every row of this type"
                  : null,
                binding?.hasMixedValues ? "mixed values across targets" : null,
                binding
                  ? `param ${binding.parameterName ?? "—"} · ${binding.storageType} · targets [${binding.targetElementIds.join(",")}]`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined;
            return {
              value: shown,
              stage: isStaged ? "staged" : isProposal ? "proposed" : "clean",
              stagedBy: "you",
              cap: binding == null ? "nohome" : editable ? "editable" : "readonly",
              capReason,
              note,
              onCommit: editable ? (text) => stageEdit(key, text) : undefined,
            };
          },
        };
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stageEdit closes over `cells`, listed
  }, [snapshot, cells]);

  const pushReason =
    stagedCount === 0
      ? "Nothing is staged yet — approve a proposal or type into a cell first. Push writes staged values through the bridge into Revit."
      : attention > 0
        ? `${attention} staged cell${attention === 1 ? "" : "s"} need review before anything is written.`
        : `Write ${stagedCount} staged cell${stagedCount === 1 ? "" : "s"} through the bridge into Revit — the only verb here that leaves the page.`;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-page">
      <AddressingBar
        name="schedules"
        sentence={
          snapshot ? (
            <span className="t-value text-ink">{snapshot.scheduleName}</span>
          ) : (
            <span className="t-value italic text-ink-mute">
              {hydrated ? "no schedule open" : "connecting"}
            </span>
          )
        }
        facts={
          <>
            <FactChip
              tone={connected ? "meta" : "caution"}
              title={
                connected
                  ? "The route-state bridge is connected — pea's proposals arrive live over SSE."
                  : "The route-state bridge is not connected. Nothing arrives and nothing can be pushed; a busy bridge is not the model disagreeing."
              }
            >
              bridge {connected ? "connected" : "disconnected"}
            </FactChip>
            {snapshot ? (
              <>
                <FactChip title="Columns × rows in this snapshot, as read from Revit.">
                  {snapshot.columns.length}×{snapshot.rows.length}
                </FactChip>
                {snapshot.truncated ? (
                  <FactChip
                    tone="caution"
                    title="The read hit its row cap — rows beyond it are not shown and cannot be edited here. Narrow the schedule in Revit or push what is visible."
                  >
                    truncated
                  </FactChip>
                ) : null}
                {snapshot.takenAt ? (
                  <FactChip title="When this snapshot was read from Revit. The model may have moved since — re-read to check.">
                    read {timeAgo(snapshot.takenAt)}
                  </FactChip>
                ) : null}
              </>
            ) : null}
          </>
        }
        verb={
          <Verb
            tone="commit"
            label={`push ${stagedCount} to Revit`}
            busy={verb.busy === "push"}
            disabled={!pushable || verb.busy != null}
            reason={pushReason}
            onClick={() =>
              runCommand(
                "push",
                "push",
                {},
                `pushed ${stagedCount} cell${stagedCount === 1 ? "" : "s"} to Revit`,
              )
            }
          />
        }
        advisory={peaActive ? <OutcomeLine kind="busy" label="pea is working" /> : undefined}
      />

      <div className="flex min-h-0 flex-1">
        <SidePane
          side="left"
          storageKey="schedule-grid:rail"
          minWidth={220}
          defaultWidth={264}
          header={
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-baseline gap-1.5">
                <span className="t-caption t-upper text-ink-2">schedules</span>
                {catalog ? (
                  <span className="face-mono t-caption normal-case text-ink-2">
                    {catalog.schedules.length}
                    {catalog.takenAt ? ` · ${timeAgo(catalog.takenAt)}` : ""}
                  </span>
                ) : null}
              </span>
              <Verb
                label="re-list"
                busy={verb.busy === "re-list"}
                disabled={verb.busy != null}
                reason="Read the document's schedule list from Revit again. A read — nothing is written."
                onClick={() => runCommand("re-list", "catalog")}
              />
            </div>
          }
        >
          {catalog == null ? (
            <div className="space-y-2 px-3 py-3">
              <EmptyState
                story="scope"
                exit="list schedules to fill this rail — a read, nothing is changed"
              >
                no schedule list yet
              </EmptyState>
              <Verb
                label="list schedules"
                busy={verb.busy === "list schedules"}
                disabled={verb.busy != null}
                reason="Reads every schedule in the document so you (or pea) can open any of them. A read — nothing is written."
                onClick={() => runCommand("list schedules", "catalog")}
              />
            </div>
          ) : (
            <PickList
              items={catalog.schedules.map((entry) => ({
                id: String(entry.scheduleId),
                label: entry.name,
                group: entry.categoryName ?? "Other",
                // ponytail: Summary projection reports 0 rows for every schedule — show counts only when computed
                meta: entry.rowCount > 0 ? entry.rowCount : undefined,
                hint: `id ${entry.scheduleId}${entry.isPlacedOnSheet ? " · placed on sheet" : ""}`,
              }))}
              activeId={snapshot ? String(snapshot.scheduleId) : null}
              onPick={(id) => runCommand("open", "refresh", { scheduleId: Number(id) })}
              placeholder="Filter schedules…"
              disabled={verb.busy != null}
              emptyNote="No schedules in the document."
              className="h-full"
            />
          )}
        </SidePane>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* grid-pane strip: the pane's own verb + the outcome lane — plain content */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1">
            <Verb
              label="re-read"
              busy={verb.busy === "re-read"}
              disabled={!snapshot || verb.busy != null}
              reason={
                snapshot
                  ? `Read “${snapshot.scheduleName}” from Revit again — replaces this snapshot; proposals and staged cells stay.`
                  : "No schedule is open — pick one from the rail."
              }
              onClick={() => runCommand("re-read", "refresh", { scheduleId: snapshot?.scheduleId })}
            />
            {verb.busy ? (
              <OutcomeLine kind="busy" label={`${verb.busy} — ${verb.seconds}s`} />
            ) : null}
            {verb.outcome ? (
              <OutcomeLine kind={verb.outcome.kind} label={verb.outcome.text} />
            ) : partial != null ? (
              <OutcomeLine
                kind="partial"
                label={partial}
                says="failed cells stay staged — fix and push again"
              />
            ) : verb.receipt ? (
              <OutcomeLine kind="receipt" label={verb.receipt.text} />
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {snapshot ? (
              <MasterTable
                rows={snapshot.rows}
                columns={gridColumns}
                rowKey={(row) => String(row.rowNumber)}
                // THE OWED MARKER (fit reviews, ruled 2026-08-16): staged cells flagged for
                // review owe a decision, and push refuses while any remain — the gutter
                // locates them per row with the count in caution ink.
                gutter={(row) => {
                  const owed = snapshot.columns.filter(
                    (column) =>
                      cells[scheduleCellKey(row.rowNumber, column.columnNumber)]?.review ===
                      "attention",
                  ).length;
                  return owed > 0
                    ? {
                        count: owed,
                        tone: "caution" as const,
                        title: `${owed} staged cell${owed === 1 ? "" : "s"} on this row ${owed === 1 ? "is" : "are"} flagged for review — push refuses while any remain`,
                      }
                    : null;
                }}
                scopeLabel="schedule rows"
                searchPlaceholder="find in cells"
                activeKey={activeRow}
                empty={
                  <EmptyState
                    story="scope"
                    exit="re-read the schedule, or pick another from the rail"
                  >
                    this schedule has no rows
                  </EmptyState>
                }
              />
            ) : (
              <div className="grid h-full place-items-center p-6">
                {hydrated ? (
                  <EmptyState
                    story="scope"
                    exit="pick one from the rail (type to filter, ↑/↓ then Enter), or ask pea to open one"
                  >
                    no schedule open
                  </EmptyState>
                ) : (
                  <OutcomeLine kind="busy" label="connecting to the workbench" />
                )}
              </div>
            )}
          </div>

          {pending.length > 0 && snapshot && (
            <PendingStrip
              pending={pending}
              proposalCount={proposalCount}
              stagedCount={stagedCount}
              attention={attention}
              columnHeader={columnHeader}
              currentText={currentText}
              stageValue={stageValue}
              deny={deny}
              undo={undo}
              locate={(key) => setActiveRow(String(splitScheduleCellKey(key).rowNumber))}
            />
          )}
        </section>
      </div>
    </main>
  );
}

/* ── pending-changes strip — every open diff in one reviewable line each ────── */

function PendingStrip({
  pending,
  proposalCount,
  stagedCount,
  attention,
  columnHeader,
  currentText,
  stageValue,
  deny,
  undo,
  locate,
}: {
  pending: [string, CellState][];
  proposalCount: number;
  stagedCount: number;
  attention: number;
  columnHeader: (columnNumber: number) => string;
  currentText: (key: string) => string | null;
  stageValue: (key: string, value: string) => void;
  deny: (key: string) => void;
  undo: (key: string) => void;
  locate: (key: string) => void;
}) {
  return (
    <div className="shrink-0 border-t border-line">
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-1.5">
        <span className="t-caption t-upper text-ink-2">pending</span>
        {/* The "nothing reaches Revit until you push" stamp lives in ONE home — the push
            verb's own reason (fit reviews, ruled 2026-08-16: repeated stamps train users to
            stop reading). */}
        <HelpTip>
          Every open diff on this schedule, one line each. Pea proposes; approving stages; typing
          over a proposed cell severs the proposal and stages your value instead.
        </HelpTip>
        <FactChip
          tone={proposalCount > 0 ? "pea" : "meta"}
          title="Open pea proposals awaiting your review."
        >
          {proposalCount} proposed
        </FactChip>
        <FactChip
          tone={stagedCount > 0 ? "caution" : "meta"}
          title="Cells staged for the next push."
        >
          {stagedCount} staged
        </FactChip>
        {attention > 0 ? (
          <FactChip tone="caution" title="Flagged staged cells — push refuses while any remain.">
            {attention} need review
          </FactChip>
        ) : null}
      </div>
      <div className="max-h-36 overflow-y-auto">
        {pending.map(([key, cell]) => {
          const { rowNumber, columnNumber } = splitScheduleCellKey(key);
          const isStaged = cell.staged != null;
          const next = isStaged ? (cell.staged?.value ?? "") : String(cell.proposal?.value ?? "");
          return (
            <div
              key={key}
              className="flex items-center gap-3 border-b border-line px-3 py-1 last:border-b-0"
            >
              <button
                type="button"
                className="flex min-w-0 shrink-0 items-baseline gap-1.5 rounded-md px-0.5 text-left hover:[background-image:linear-gradient(var(--pe-veil),var(--pe-veil))]"
                title="Highlight this cell's row in the grid and scroll it into view."
                onClick={() => locate(key)}
              >
                <span className="t-label max-w-44 truncate text-ink">
                  {columnHeader(columnNumber)}
                </span>
                <span className="face-mono t-caption text-ink-2">r{rowNumber}</span>
              </button>
              <ValueDiff
                from={currentText(key)}
                to={next}
                className={
                  isStaged
                    ? "min-w-0 flex-1 truncate font-bold text-caution"
                    : "min-w-0 flex-1 truncate text-pea-ink"
                }
              />
              {!isStaged && cell.proposal?.note && (
                <span className="t-label hidden max-w-56 truncate text-ink-2 sm:block">
                  {cell.proposal.note}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-1.5">
                {isStaged ? (
                  <Verb
                    label="unstage"
                    reason="Return this cell to its snapshot value. A proposal it was approved from is restored to the open list."
                    onClick={() => undo(key)}
                  />
                ) : (
                  <>
                    <Verb
                      label="deny"
                      reason="Clear pea's proposal for this cell — the snapshot value stands."
                      onClick={() => deny(key)}
                    />
                    <Verb
                      label="approve"
                      reason={`Approve and stage "${String(cell.proposal?.value ?? "")}" for the next push.`}
                      onClick={() => stageValue(key, String(cell.proposal?.value ?? ""))}
                    />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Surface push per-cell failures returned in the command result (fold successes silently). */
function pushFailureNote(result: unknown): string | null {
  if (typeof result !== "object" || result == null) return null;
  const failures = (result as { failures?: unknown }).failures;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const first = failures[0] as { key?: string; error?: string };
  return `${failures.length} cell${failures.length === 1 ? "" : "s"} failed${
    first?.error ? `: ${first.error}` : "."
  }`;
}
