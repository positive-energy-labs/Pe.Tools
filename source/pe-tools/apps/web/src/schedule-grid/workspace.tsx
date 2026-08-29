import { useState } from "react";
import { scheduleCellKey, scheduleGridRouteState, splitScheduleCellKey } from "@pe/agent-contracts";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { Tag } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Provenance } from "#/components/lang/section";
import { Verb } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { VerbLane } from "#/components/verb-lane";
import { timeAgo } from "#/lib/utils";
import { useRouteState } from "#/workbench/route-state";
import { PendingStrip } from "#/schedule-grid/pending-strip";
import { useScheduleGridColumns } from "#/schedule-grid/columns";

export function ScheduleGridWorkspace({
  documentAddress,
}: {
  documentAddress: import("@pe/agent-contracts").Address;
}) {
  const { slice, hydrated, apply, command, peaActive, connected, busy, atoms } = useRouteState(
    scheduleGridRouteState,
    { documentAddress },
  );
  const document = slice;
  const snapshot = document?.snapshot ?? null;
  const catalog = document?.catalog ?? null;
  const cells = document?.cells ?? {};

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

  const runCommand = (
    kind: "catalog" | "refresh" | "push",
    input: Record<string, unknown> = {},
    receipt?: string,
  ) => void command(kind, input, receipt);

  const stageValue = (key: string, value: string) =>
    void apply([
      { path: ["cells", key, "staged"], value: { value } },
      { path: ["cells", key, "review"], value: "good" },
    ]);
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

  const gridColumns = useScheduleGridColumns(snapshot, cells, stageEdit);

  const pushReason =
    stagedCount === 0
      ? "Nothing is staged yet — approve a proposal or type into a cell first. Push writes staged values through the bridge into Revit."
      : attention > 0
        ? `${attention} staged cell${attention === 1 ? "" : "s"} need review before anything is written.`
        : `Write ${stagedCount} staged cell${stagedCount === 1 ? "" : "s"} through the bridge into Revit — the only verb here that leaves the page.`;

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <AddressingBar
        name="schedules"
        sentence={
          snapshot ? (
            <span>{snapshot.scheduleName}</span>
          ) : (
            <Provenance>{hydrated ? "no schedule open" : "connecting"}</Provenance>
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
            busy={busy === "push"}
            disabled={!pushable || busy != null}
            reason={pushReason}
            onClick={() =>
              runCommand(
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
                <Tag>schedules</Tag>
                {catalog ? (
                  <FactChip title="Schedules returned by the current catalog read.">
                    {catalog.schedules.length}
                    {catalog.takenAt ? ` · ${timeAgo(catalog.takenAt)}` : ""}
                  </FactChip>
                ) : null}
              </span>
              <Verb
                label="re-list"
                busy={busy === "catalog"}
                disabled={busy != null}
                reason="Read the document's schedule list from Revit again. A read — nothing is written."
                onClick={() => runCommand("catalog")}
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
                busy={busy === "catalog"}
                disabled={busy != null}
                reason="Reads every schedule in the document so you (or pea) can open any of them. A read — nothing is written."
                onClick={() => runCommand("catalog")}
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
              onPick={(id) => runCommand("refresh", { scheduleId: Number(id) })}
              placeholder="Filter schedules…"
              disabled={busy != null}
              emptyNote="No schedules in the document."
            />
          )}
        </SidePane>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-1">
            <Verb
              label="re-read"
              busy={busy === "refresh"}
              disabled={!snapshot || busy != null}
              reason={
                snapshot
                  ? `Read “${snapshot.scheduleName}” from Revit again — replaces this snapshot; proposals and staged cells stay.`
                  : "No schedule is open — pick one from the rail."
              }
              onClick={() => runCommand("refresh", { scheduleId: snapshot?.scheduleId })}
            />
            <VerbLane atoms={atoms} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {snapshot ? (
              <MasterTable
                rows={snapshot.rows}
                columns={gridColumns}
                rowKey={(row) => String(row.rowNumber)}
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
