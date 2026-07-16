import { createFileRoute } from "@tanstack/react-router";
import { Check, CheckCheck, List, Loader2, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { useState } from "react";

import {
  type ScheduleCellBinding,
  type ScheduleGridDocument,
  scheduleCellKey,
  scheduleGridRouteState,
  splitScheduleCellKey,
} from "@pe/agent-contracts";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { ValueDiff } from "#/components/ui/value-diff";
import { HostConnectionPill } from "#/host/issues";
import { cn } from "#/lib/utils";
import { useRouteState } from "#/workbench/route-state";

/**
 * /schedule-grid — a web surface for editing any Revit schedule collaboratively. The rail
 * (SidePane + PickList) lists every schedule in the document; filter + ↑/↓ + Enter opens one
 * into the grid with cell binding handles. pea proposes cell values; the engineer reviews in
 * the grid or the pending-changes strip, stages, and pushes back to Revit. All state lives in
 * the route-state document, written through the dispatcher as `actor:"human"`. Cells carry a
 * proposal → staged → pushed trichotomy rendered as ValueDiff; only the human can push.
 */
export const Route = createFileRoute("/schedule-grid")({
  component: ScheduleGridRoute,
});

type CellState = NonNullable<ScheduleGridDocument["cells"][string]>;

function ScheduleGridRoute() {
  const { slice, hydrated, apply, command, peaActive, connected } =
    useRouteState(scheduleGridRouteState);
  const document = slice;
  const snapshot = document?.snapshot ?? null;
  const catalog = document?.catalog ?? null;
  const cells = document?.cells ?? {};

  const [busy, setBusy] = useState<null | "catalog" | "refresh" | "push">(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null);

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

  const run = async (kind: "catalog" | "refresh" | "push", input: Record<string, unknown> = {}) => {
    setBusy(kind);
    setError(null);
    try {
      const result = await command(kind, input);
      if (!result.ok) setError(result.error ?? result.hint ?? `${kind} failed.`);
      else setError(pushFailureNote(result.result));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${kind} failed.`);
    } finally {
      setBusy(null);
    }
  };

  const stageValue = (key: string, value: string) =>
    void apply([
      { path: ["cells", key, "staged"], value: { value } },
      { path: ["cells", key, "review"], value: "good" },
    ]);
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

  const commitEdit = () => {
    if (edit && edit.value.length > 0) stageValue(edit.key, edit.value);
    setEdit(null);
  };

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

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border px-4 pb-2 pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate font-pe-display text-lg font-semibold tracking-tight">
              {snapshot?.scheduleName ?? "Schedules"}
            </h1>
            <span className="tele text-muted-foreground">
              {snapshot
                ? `${snapshot.columns.length}×${snapshot.rows.length}${
                    snapshot.truncated ? " · truncated" : ""
                  }${snapshot.takenAt ? ` · read ${timeAgo(snapshot.takenAt)}` : ""}`
                : hydrated
                  ? "no schedule open"
                  : "connecting…"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HostConnectionPill connected={connected} label="Connected" />
            {peaActive && (
              <span className="tele-label inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--pea-line)] bg-[var(--pea-tint)] px-2 py-0.5 text-[var(--pe-green)]">
                <Sparkles className="size-3 animate-pulse" />
                pea working
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy != null || !snapshot}
              onClick={() => void run("refresh", { scheduleId: snapshot?.scheduleId })}
              title="Re-read this schedule from Revit"
            >
              <RefreshCw className={busy === "refresh" ? "animate-spin" : ""} />
              Re-read
            </Button>
            <Button
              size="sm"
              disabled={!pushable || busy != null}
              onClick={() => void run("push")}
              title={
                stagedCount === 0
                  ? "Nothing staged yet — approve a proposal or edit a cell"
                  : attention > 0
                    ? `${attention} staged cell${attention === 1 ? "" : "s"} need review first`
                    : undefined
              }
            >
              {busy === "push" ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              {busy === "push" ? "Pushing…" : `Push ${stagedCount} to Revit`}
            </Button>
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </header>

      <div className="flex min-h-0 flex-1">
        <SidePane
          side="left"
          storageKey="schedule-grid:rail"
          minWidth={220}
          defaultWidth={264}
          header={
            <div className="flex items-center justify-between gap-2">
              <span className="section-label">
                Schedules
                {catalog && (
                  <span className="tele ml-1.5 normal-case text-muted-foreground">
                    {catalog.schedules.length}
                    {catalog.takenAt ? ` · ${timeAgo(catalog.takenAt)}` : ""}
                  </span>
                )}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                title="Re-list the document's schedules"
                disabled={busy != null}
                onClick={() => void run("catalog")}
              >
                {busy === "catalog" ? <Loader2 className="animate-spin" /> : <List />}
              </Button>
            </div>
          }
        >
          {catalog == null ? (
            <div className="px-3 py-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy != null}
                onClick={() => void run("catalog")}
              >
                {busy === "catalog" ? <Loader2 className="animate-spin" /> : <List />}
                List schedules
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Reads every schedule in the document so you (or pea) can open any of them.
              </p>
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
              onPick={(id) => void run("refresh", { scheduleId: Number(id) })}
              placeholder="Filter schedules…"
              disabled={busy != null}
              emptyNote="No schedules in the document."
              className="h-full"
            />
          )}
        </SidePane>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {snapshot ? (
              <ScheduleTable
                snapshot={snapshot}
                cells={cells}
                edit={edit}
                setEdit={setEdit}
                commitEdit={commitEdit}
                stageValue={stageValue}
                deny={deny}
                undo={undo}
              />
            ) : (
              <div className="grid h-full place-items-center">
                <div className="max-w-sm text-center">
                  <p className="text-sm text-foreground">
                    {hydrated ? "Open a schedule to start editing" : "Connecting to the workbench…"}
                  </p>
                  {hydrated && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      Pick one from the rail (type to filter, ↑/↓ then Enter), or ask pea — it can
                      list, open, and propose; only you can push.
                    </p>
                  )}
                </div>
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
            />
          )}
        </section>
      </div>
    </main>
  );
}

/* ── the grid — dense hairline table, tele values, trichotomy tints ─────────── */

function ScheduleTable({
  snapshot,
  cells,
  edit,
  setEdit,
  commitEdit,
  stageValue,
  deny,
  undo,
}: {
  snapshot: NonNullable<ScheduleGridDocument["snapshot"]>;
  cells: Record<string, CellState>;
  edit: { key: string; value: string } | null;
  setEdit: (edit: { key: string; value: string } | null) => void;
  commitEdit: () => void;
  stageValue: (key: string, value: string) => void;
  deny: (key: string) => void;
  undo: (key: string) => void;
}) {
  return (
    <div className="inline-block min-w-0 max-w-full overflow-auto rounded-[var(--radius)] border border-border bg-card">
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="tele-label border-b border-border bg-muted px-2.5 py-1.5 text-right font-normal text-muted-foreground">
              #
            </th>
            {snapshot.columns.map((column) => (
              <th
                key={column.columnNumber}
                className="tele-label border-b border-l border-border bg-muted px-2.5 py-1.5 text-left font-normal text-muted-foreground"
              >
                {column.headerText}
                {column.isCalculated && (
                  <Badge variant="kiln" className="ml-1.5 align-middle">
                    calc
                  </Badge>
                )}
                {column.isCombinedParameter && (
                  <Badge variant="kiln" className="ml-1.5 align-middle">
                    comb
                  </Badge>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.rows.map((row) => (
            <tr key={row.rowNumber}>
              <td
                className="tele whitespace-nowrap border-b border-[var(--line-soft)] px-2.5 py-1 text-right text-muted-foreground"
                title={`row ${row.rowNumber} · ${row.kind}${row.subjectIds.length > 0 ? ` · elements [${row.subjectIds.join(",")}]` : ""}`}
              >
                {row.rowNumber}
                {row.subjectIds.length > 1 ? ` ×${row.subjectIds.length}` : ""}
              </td>
              {snapshot.columns.map((column, columnIndex) => {
                const key = scheduleCellKey(row.rowNumber, column.columnNumber);
                const binding = row.bindings.find(
                  (candidate) => candidate.columnNumber === column.columnNumber,
                );
                return (
                  <Cell
                    key={column.columnNumber}
                    cellKey={key}
                    text={row.values[columnIndex] ?? ""}
                    binding={binding}
                    cell={cells[key]}
                    editing={edit?.key === key ? edit.value : null}
                    onEditStart={() =>
                      binding?.isEditable && binding.blocker === "None"
                        ? setEdit({
                            key,
                            value: cells[key]?.staged?.value ?? row.values[columnIndex] ?? "",
                          })
                        : undefined
                    }
                    onEditChange={(value) => setEdit({ key, value })}
                    onEditCommit={commitEdit}
                    onEditCancel={() => setEdit(null)}
                    onApprove={stageValue}
                    onDeny={deny}
                    onUndo={undo}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CellProps {
  cellKey: string;
  text: string;
  binding: ScheduleCellBinding | undefined;
  cell: CellState | undefined;
  editing: string | null;
  onEditStart: () => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onApprove: (key: string, value: string) => void;
  onDeny: (key: string) => void;
  onUndo: (key: string) => void;
}

function Cell({
  cellKey,
  text,
  binding,
  cell,
  editing,
  onEditStart,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onApprove,
  onDeny,
  onUndo,
}: CellProps) {
  const staged = cell?.staged != null;
  const proposal = !staged && cell?.proposal != null;
  const attention = cell?.review === "attention";
  const editable = binding?.isEditable === true && binding.blocker === "None";
  const current = binding?.displayValue ?? text;
  const next = staged
    ? (cell?.staged?.value ?? "")
    : proposal
      ? String(cell?.proposal?.value ?? "")
      : null;

  const tooltip = binding
    ? [
        `param: ${binding.parameterName ?? "—"} (${binding.parameterId ?? "—"})`,
        `storage: ${binding.storageType}`,
        `targets: [${binding.targetElementIds.join(",")}]`,
        binding.blocker !== "None" ? `blocker: ${binding.blocker}` : null,
        binding.hasMixedValues ? "mixed values" : null,
        proposal && cell?.proposal?.note ? `pea: ${cell.proposal.note}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "no binding (row unbound)";

  return (
    <td
      id={`cell-${cellKey}`}
      className={cn(
        "border-b border-l border-[var(--line-soft)] px-2.5 py-1 align-top",
        !editable && "bg-muted/40 text-muted-foreground",
        editable && "cursor-text hover:bg-primary/5",
        staged && "bg-cat-green/12",
        proposal && "bg-cat-clay/12",
        attention && "bg-destructive/10",
      )}
      title={tooltip}
      onClick={editing == null && !proposal ? onEditStart : undefined}
    >
      {editing != null ? (
        <Input
          autoFocus
          value={editing}
          onChange={(event) => onEditChange(event.target.value)}
          onBlur={onEditCancel}
          onKeyDown={(event) => {
            if (event.key === "Enter") onEditCommit();
            else if (event.key === "Escape") onEditCancel();
          }}
          className="tele h-6 min-w-20 rounded-none border-primary bg-background px-1"
        />
      ) : (
        <div className="flex items-start gap-1.5">
          <ValueDiff
            from={next != null ? current : null}
            to={next ?? current}
            className={cn(
              "min-w-8 whitespace-pre-wrap",
              staged && "font-medium text-cat-green",
              proposal && "font-medium text-cat-clay",
            )}
          />
          {binding?.isTypeParameter && (
            <span
              className="tele-label text-cat-kiln"
              title="type parameter — shared across rows of this type"
            >
              T
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {proposal ? (
              <>
                <CellAction
                  title={`Deny — ${cell?.proposal?.note ?? "pea proposal"}`}
                  hover="hover:text-destructive"
                  onClick={() => onDeny(cellKey)}
                >
                  <X className="size-3.5" />
                </CellAction>
                <CellAction
                  title={`Approve and stage "${cell?.proposal?.value ?? ""}"`}
                  hover="hover:text-cat-green"
                  onClick={() =>
                    onApprove(cellKey, (cell?.proposal?.value as string | undefined) ?? "")
                  }
                >
                  <Check className="size-3.5" />
                </CellAction>
              </>
            ) : staged ? (
              <CellAction
                title="Undo stage"
                hover="hover:text-foreground"
                onClick={() => onUndo(cellKey)}
              >
                <RotateCcw className="size-3.5" />
              </CellAction>
            ) : null}
          </span>
        </div>
      )}
    </td>
  );
}

function CellAction({
  title,
  hover,
  onClick,
  children,
}: {
  title: string;
  hover: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn("text-muted-foreground", hover)}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
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
}) {
  return (
    <div className="shrink-0 border-t border-border bg-card">
      <div className="flex items-baseline gap-3 border-b border-[var(--line-soft)] px-3 py-1.5">
        <span className="section-label">Pending changes</span>
        <span className="tele text-muted-foreground">
          {proposalCount} proposed · {stagedCount} staged
          {attention > 0 ? ` · ${attention} need review` : ""}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Pea can propose; only you can push.
        </span>
      </div>
      <div className="max-h-36 overflow-y-auto">
        {pending.map(([key, cell]) => {
          const { rowNumber, columnNumber } = splitScheduleCellKey(key);
          const isStaged = cell.staged != null;
          const next = isStaged ? (cell.staged?.value ?? "") : String(cell.proposal?.value ?? "");
          return (
            <div
              key={key}
              className="flex items-center gap-3 border-b border-[var(--line-soft)] px-3 py-1 last:border-b-0"
            >
              <button
                type="button"
                className="flex min-w-0 shrink-0 items-baseline gap-1.5 text-left hover:underline"
                title="Show this cell in the grid"
                onClick={() =>
                  document
                    .getElementById(`cell-${key}`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" })
                }
              >
                <span className="max-w-44 truncate text-xs font-medium">
                  {columnHeader(columnNumber)}
                </span>
                <span className="tele text-[10px] text-muted-foreground">r{rowNumber}</span>
              </button>
              <ValueDiff
                from={currentText(key)}
                to={next}
                className={cn(
                  "min-w-0 flex-1 truncate",
                  isStaged ? "text-cat-green" : "text-cat-clay",
                )}
              />
              {!isStaged && cell.proposal?.note && (
                <span className="hidden max-w-56 truncate text-[11px] text-muted-foreground sm:block">
                  {cell.proposal.note}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-0.5">
                {isStaged ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    title="Undo stage"
                    onClick={() => undo(key)}
                  >
                    <RotateCcw />
                  </Button>
                ) : (
                  <>
                    <Button size="icon-sm" variant="ghost" title="Deny" onClick={() => deny(key)}>
                      <X />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Approve and stage"
                      onClick={() => stageValue(key, String(cell.proposal?.value ?? ""))}
                    >
                      <Check />
                    </Button>
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

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
