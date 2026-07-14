import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, CheckCheck, Loader2, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
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
 * /schedule-grid — a web surface for editing one Revit schedule collaboratively. pea reads
 * the schedule into the `route:schedule-grid` snapshot and proposes cell values; the engineer
 * reviews, stages, and pushes back to Revit. All state lives in the route-state document,
 * written through the dispatcher as `actor:"human"`. Cells carry a proposal → staged → pushed
 * trichotomy; only the human can push. Lean working slice, not a spreadsheet product.
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
  const cells = document?.cells ?? {};

  const [busy, setBusy] = useState<null | "refresh" | "push">(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState("");
  const [edit, setEdit] = useState<{ key: string; value: string } | null>(null);

  const staged = Object.entries(cells).filter(([, cell]) => cell.staged != null);
  const stagedCount = staged.length;
  const attention = staged.filter(([, cell]) => cell.review === "attention").length;
  const proposalCount = Object.values(cells).filter(
    (cell) => cell.proposal != null && cell.staged == null,
  ).length;
  const pushable = stagedCount > 0 && attention === 0;

  const run = async (kind: "refresh" | "push") => {
    setBusy(kind);
    setError(null);
    try {
      const result = await command(
        kind,
        kind === "refresh" && scheduleName.trim() ? { scheduleName: scheduleName.trim() } : {},
      );
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
              {snapshot?.scheduleName ?? "Schedule Grid"}
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

            <input
              value={scheduleName}
              onChange={(e) => setScheduleName(e.target.value)}
              placeholder="active view"
              className="h-8 w-40 rounded-sm border-[0.5px] border-[var(--line)] bg-[var(--paper)] px-2 text-xs outline-none focus:border-[var(--pe-blue)]"
              title="Schedule name to read; blank reads the current active schedule view"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy != null}
              onClick={() => void run("refresh")}
            >
              <RefreshCw className={busy === "refresh" ? "animate-spin" : ""} />
              {snapshot ? "Re-read" : "Read schedule"}
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
              ? "No schedule read yet. Open a schedule view in Revit and press Read schedule (or name one)."
              : "Connecting to the workbench…"}
          </p>
        )}
      </div>
    </main>
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
  const display = staged ? cell?.staged?.value : (binding?.displayValue ?? text);

  const tooltip = binding
    ? [
        `param: ${binding.parameterName ?? "—"} (${binding.parameterId ?? "—"})`,
        `storage: ${binding.storageType}`,
        `targets: [${binding.targetElementIds.join(",")}]`,
        binding.blocker !== "None" ? `blocker: ${binding.blocker}` : null,
        binding.hasMixedValues ? "mixed values" : null,
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
          <span
            className={cn(
              "tele min-w-8 whitespace-pre-wrap",
              staged && "font-medium text-[var(--cat-green)]",
              proposal && "text-[var(--cat-clay)]",
            )}
          >
            {display || "—"}
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
