import {
  cellSummary,
  parseRouteDoc,
  scheduleGridRouteState,
  splitScheduleCellKey,
} from "@pe/agent-contracts";
import { Link } from "@tanstack/react-router";

import { ValueDiff } from "#/components/ui/value-diff";
import { timeAgo } from "#/lib/utils";

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
  routeState,
}: RouteChatPluginProps) {
  const document = parseRouteDoc(sessionState, scheduleGridRouteState);
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
    <InlineRoutePlugin
      title={scheduleGridRouteState.title}
      action={actionLabel(toolName, args, running)}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        {snapshot ? (
          <span className="min-w-0 truncate t-value text-ink">
            {snapshot.scheduleName}
            <span className="ml-1.5 t-caption face-mono text-ink-2">
              {snapshot.rows.length}×{snapshot.columns.length}
              {snapshot.takenAt ? ` · read ${timeAgo(snapshot.takenAt)}` : ""}
            </span>
          </span>
        ) : (
          <span className="text-ink-mute">no schedule read</span>
        )}
        <Metric value={openProposals} label="open proposals" />
        <Metric value={summary.staged} label="staged" />
        <Metric value={summary.attention} label="need attention" issue />
        <Link
          className="ml-auto text-nav hover:underline"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "schedule-grid" })}
        >
          Open workspace
        </Link>
      </div>

      {active && reviewable ? (
        <CellTrichotomyReviewer
          state={routeState}
          segment="cells"
          cells={cells}
          commitCommand="push"
          commitLabel={(staged) => `Push ${staged} to Revit`}
          reviewHint="Pea can propose; only you can push."
          renderLabel={(key) => {
            const { rowNumber, columnNumber } = splitScheduleCellKey(key);
            return (
              <>
                {columnLabel(columnNumber)} <span className="text-ink-2">· row {rowNumber}</span>
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
