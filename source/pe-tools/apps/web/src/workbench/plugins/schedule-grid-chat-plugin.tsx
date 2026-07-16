import {
  cellSummary,
  readRouteState,
  scheduleGridRouteState,
  splitScheduleCellKey,
} from "@pe/agent-contracts";
import { Link } from "@tanstack/react-router";

import { ValueDiff } from "#/components/ui/value-diff";

import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";
import { CellTrichotomyReviewer } from "../trichotomy-reviewer";

/**
 * Inline chat card + reviewer for the /schedule-grid route. The compact card names the
 * schedule under edit (with snapshot freshness) and shows counts; when active (the
 * authoritative end-of-chat dock) it lists every proposal/staged cell as a
 * current → proposed diff resolved from the snapshot, and lets the human approve → stage,
 * deny, undo, and push — each a human-actor write through the route-state dispatcher.
 */
export function ScheduleGridChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  active,
}: RouteChatPluginProps) {
  const document = readRouteState(sessionState, scheduleGridRouteState);
  const snapshot = document?.snapshot ?? null;
  const cells = document?.cells ?? {};
  const summary = cellSummary(cells);
  const openProposals = Object.values(cells).filter(
    (cell) => cell.proposal != null && cell.staged == null,
  ).length;
  const reviewable = Object.values(cells).some(
    (cell) => cell.proposal != null || cell.staged != null,
  );

  if (active && !reviewable) return null;

  const columnLabel = (columnNumber: number) =>
    snapshot?.columns.find((column) => column.columnNumber === columnNumber)?.headerText ??
    `col ${columnNumber}`;

  /** What Revit currently shows in this cell — the "from" side of the diff. */
  const currentValue = (key: string): string | null => {
    if (!snapshot) return null;
    const { rowNumber, columnNumber } = splitScheduleCellKey(key);
    const row = snapshot.rows.find((candidate) => candidate.rowNumber === rowNumber);
    if (!row) return null;
    const binding = row.bindings.find((candidate) => candidate.columnNumber === columnNumber);
    const columnIndex = snapshot.columns.findIndex(
      (column) => column.columnNumber === columnNumber,
    );
    return binding?.displayValue ?? (columnIndex >= 0 ? (row.values[columnIndex] ?? null) : null);
  };

  return (
    <InlineRoutePlugin title="Schedule Grid" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        {snapshot ? (
          <span className="min-w-0 truncate font-medium text-[var(--clay-ink)]">
            {snapshot.scheduleName}
            <span className="tele-label ml-1.5 font-normal text-[var(--lichen)]">
              {snapshot.rows.length}×{snapshot.columns.length}
              {snapshot.takenAt ? ` · read ${timeAgo(snapshot.takenAt)}` : ""}
            </span>
          </span>
        ) : (
          <span className="text-[var(--slate)]">no schedule read</span>
        )}
        <Metric value={openProposals} label="open proposals" />
        <Metric value={summary.staged} label="staged" />
        <Metric value={summary.attention} label="need attention" issue />
        <Link
          className="ml-auto font-medium text-[var(--pe-blue)] hover:underline"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "schedule-grid" })}
        >
          Open workspace
        </Link>
      </div>

      {active && reviewable ? (
        <CellTrichotomyReviewer
          route="schedule-grid"
          segment="cells"
          cells={cells}
          commitCommand="push"
          commitLabel={(staged) => `Push ${staged} to Revit`}
          reviewHint="Pea can propose; only you can push."
          renderLabel={(key) => {
            const { rowNumber, columnNumber } = splitScheduleCellKey(key);
            return (
              <>
                {columnLabel(columnNumber)}{" "}
                <span className="font-normal text-[var(--lichen)]">· row {rowNumber}</span>
              </>
            );
          }}
          renderValue={(value, key) => {
            const next =
              typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
            return <ValueDiff from={currentValue(key)} to={next} />;
          }}
        />
      ) : null}
    </InlineRoutePlugin>
  );
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(min)) return "";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return hr < 24 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
}
