import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, CheckCheck, List, Loader2, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { useState } from "react";

import {
  type ScheduleCellBinding,
  type ScheduleGridDocument,
  scheduleCellKey,
  scheduleGridRouteState,
} from "@pe/agent-contracts";

import { Button } from "#/components/ui/button";
import { HostConnectionPill } from "#/host/issues";
import { cn } from "#/lib/utils";
import { useRouteState } from "#/workbench/route-state";

/**
 * /schedule-grid — a web surface for editing any Revit schedule collaboratively. The catalog
 * rail lists every schedule in the document (the `catalog` command); picking one reads it
 * into the snapshot with cell binding handles. pea proposes cell values; the engineer
 * reviews, stages, and pushes back to Revit. All state lives in the route-state document,
 * written through the dispatcher as `actor:"human"`. Cells carry a proposal → staged → pushed
 * trichotomy rendered as a visible current → proposed diff; only the human can push.
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
  const approve = (key: string, value: string) => stageValue(key, value);
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

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--paper)]">
      <header className="shrink-0 border-b border-[var(--line-2)] px-5 pb-2.5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              {snapshot?.scheduleName ?? "Schedules"}
            </h1>
            <span className="text-xs text-[var(--slate)]">
              {snapshot
                ? `${snapshot.columns.length} column${snapshot.columns.length === 1 ? "" : "s"} · ${
                    snapshot.rows.length
                  } row${snapshot.rows.length === 1 ? "" : "s"}${
                    snapshot.truncated ? " · truncated" : ""
                  }${snapshot.takenAt ? ` · read ${timeAgo(snapshot.takenAt)}` : ""}`
                : hydrated
                  ? "no schedule read"
                  : "connecting…"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <HostConnectionPill connected={connected} label="Connected" />
            {peaActive && (
              <span className="tele-label inline-flex items-center gap-1.5 rounded-sm border-[0.5px] border-[var(--pea-line)] bg-[var(--pea-tint)] px-2 py-0.5 text-[var(--cat-green)]">
                <Sparkles className="size-3 animate-pulse" />
                pea working
              </span>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={busy != null}
              onClick={() => void run("refresh")}
              title="Read the schedule view currently active in Revit"
            >
              <RefreshCw className={busy === "refresh" ? "animate-spin" : ""} />
              {snapshot ? "Re-read" : "Read active view"}
            </Button>

            <Button
              size="sm"
              disabled={!pushable || busy != null}
              onClick={() => void run("push")}
              title={
                stagedCount === 0
                  ? "nothing staged"
                  : attention > 0
                    ? `${attention} cell${attention === 1 ? "" : "s"} need attention`
                    : undefined
              }
            >
              {busy === "push" ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              {busy === "push" ? "Pushing…" : `Push ${stagedCount} to Revit`}
            </Button>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
          <span className="text-[var(--slate)]">
            {proposalCount} open proposal{proposalCount === 1 ? "" : "s"} · {stagedCount} staged
          </span>
          {attention > 0 && (
            <span className="text-[var(--cat-clay)]">
              {attention} cell{attention === 1 ? "" : "s"} need attention
            </span>
          )}
          {error && <span className="text-[var(--fail)]">{error}</span>}
          <Link
            className="ml-auto font-medium text-[var(--pe-blue)] hover:underline"
            to="/chat"
            search={(previous) => ({ ...previous, plugin: "schedule-grid" })}
          >
            Open chat
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SchedulePicker
          catalog={catalog}
          activeScheduleId={snapshot?.scheduleId ?? null}
          busy={busy}
          onList={() => void run("catalog")}
          onPick={(scheduleId) => void run("refresh", { scheduleId })}
        />

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {snapshot ? (
            <table className="border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--paper-2)]">
                <tr>
                  <th className="tele-label border-b border-[var(--line)] px-2 py-1.5 text-[var(--slate)]">
                    #
                  </th>
                  {snapshot.columns.map((column) => (
                    <th
                      key={column.columnNumber}
                      className="tele-label border-b border-l border-[var(--line-soft)] px-2 py-1.5 text-[var(--slate)]"
                    >
                      {column.headerText}
                      {column.isCalculated && <ColBadge label="calc" />}
                      {column.isCombinedParameter && <ColBadge label="comb" />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-b border-[var(--line-soft)]">
                    <td
                      className="tele whitespace-nowrap px-2 py-1 text-right text-[var(--slate)]"
                      title={`row ${row.rowNumber} · ${row.kind} · subjects=[${row.subjectIds.join(",")}]`}
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
                          onApprove={approve}
                          onDeny={deny}
                          onUndo={undo}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-[var(--slate)]">
              {hydrated
                ? "No schedule read yet. Pick one from the rail, or open a schedule view in Revit and press Read active view."
                : "Connecting to the workbench…"}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

/** The catalog rail — every schedule in the document, grouped by category; pick to read. */
function SchedulePicker({
  catalog,
  activeScheduleId,
  busy,
  onList,
  onPick,
}: {
  catalog: ScheduleGridDocument["catalog"];
  activeScheduleId: number | null;
  busy: string | null;
  onList: () => void;
  onPick: (scheduleId: number) => void;
}) {
  const groups = new Map<string, NonNullable<typeof catalog>["schedules"]>();
  for (const entry of catalog?.schedules ?? []) {
    const category = entry.categoryName ?? "Other";
    groups.set(category, [...(groups.get(category) ?? []), entry]);
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--line-2)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2">
        <span className="tele-label text-[10px] text-[var(--slate)]">
          schedules{catalog ? ` · ${catalog.schedules.length}` : ""}
          {catalog?.takenAt ? ` · ${timeAgo(catalog.takenAt)}` : ""}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          title="List every schedule in the document"
          disabled={busy != null}
          onClick={onList}
        >
          {busy === "catalog" ? <Loader2 className="animate-spin" /> : <List />}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {catalog == null ? (
          <div className="px-3 py-2">
            <Button size="sm" variant="outline" disabled={busy != null} onClick={onList}>
              <List /> List schedules
            </Button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--slate)]">
              Reads the document's schedule catalog so you (or pea) can open any of them.
            </p>
          </div>
        ) : catalog.schedules.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-[var(--slate)]">No schedules in the document.</p>
        ) : (
          [...groups.entries()].map(([category, entries]) => (
            <div key={category} className="mb-1">
              <p className="tele-label px-3 pb-0.5 pt-1.5 text-[9px] text-[var(--lichen)]">
                {category}
              </p>
              {entries.map((entry) => {
                const active = entry.scheduleId === activeScheduleId;
                return (
                  <button
                    key={entry.scheduleId}
                    type="button"
                    disabled={busy != null}
                    onClick={() => onPick(entry.scheduleId)}
                    title={`id ${entry.scheduleId}${entry.isPlacedOnSheet ? " · placed on sheet" : ""}`}
                    className={cn(
                      "flex w-full items-baseline gap-2 px-3 py-1 text-left text-[11px] hover:bg-[var(--pe-blue)]/8",
                      active
                        ? "border-l-2 border-[var(--pe-blue)] bg-[var(--pe-blue)]/8 font-medium text-[var(--pe-blue)]"
                        : "border-l-2 border-transparent text-[var(--clay-ink)]",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span className="tele shrink-0 text-[9px] text-[var(--slate)]">
                      {entry.rowCount}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
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
  const showDiff = next != null && next !== current;

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
      className={cn(
        "border-l border-[var(--line-soft)] px-2 py-1 align-top",
        !editable && "bg-[var(--paper-2)]/40 text-[var(--slate)]",
        editable && "cursor-text",
        staged && "bg-cat-green/12",
        proposal && "bg-cat-clay/12",
        attention && "bg-destructive/12",
      )}
      title={tooltip}
      onClick={editing == null && !proposal ? onEditStart : undefined}
    >
      {editing != null ? (
        <input
          autoFocus
          value={editing}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEditCancel}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEditCommit();
            else if (e.key === "Escape") onEditCancel();
          }}
          className="tele w-full min-w-16 rounded-none border-[0.5px] border-[var(--pe-blue)] bg-[var(--paper)] px-1 outline-none"
        />
      ) : (
        <div className="flex items-start gap-1">
          <span className="tele min-w-8 whitespace-pre-wrap">
            {showDiff && (
              <span className="mr-1 text-[var(--slate)] line-through opacity-70">
                {current || "—"}
              </span>
            )}
            <span
              className={cn(
                staged && "font-medium text-[var(--cat-green)]",
                proposal && "font-medium text-[var(--cat-clay)]",
              )}
            >
              {(next ?? current) || "—"}
            </span>
            {binding?.isTypeParameter && (
              <span
                className="tele-label ml-1 align-super text-[var(--cat-kiln)]"
                title="type parameter — shared across rows of this type"
              >
                T
              </span>
            )}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {proposal ? (
              <>
                <button
                  type="button"
                  title={`Deny — ${cell?.proposal?.note ?? "pea proposal"}`}
                  className="text-[var(--slate)] hover:text-[var(--fail)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeny(cellKey);
                  }}
                >
                  <X className="size-3.5" />
                </button>
                <button
                  type="button"
                  title={`Approve → stage "${cell?.proposal?.value ?? ""}"`}
                  className="text-[var(--slate)] hover:text-[var(--cat-green)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove(cellKey, (cell?.proposal?.value as string | undefined) ?? "");
                  }}
                >
                  <Check className="size-3.5" />
                </button>
              </>
            ) : staged ? (
              <button
                type="button"
                title="Undo stage"
                className="text-[var(--slate)] hover:text-[var(--clay-ink)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onUndo(cellKey);
                }}
              >
                <RotateCcw className="size-3.5" />
              </button>
            ) : null}
          </span>
        </div>
      )}
    </td>
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

function ColBadge({ label }: { label: string }) {
  return (
    <span className="tele-label ml-1 rounded-sm border-[0.5px] border-cat-clay/25 bg-cat-clay/12 px-1 text-[var(--cat-clay)]">
      {label}
    </span>
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
