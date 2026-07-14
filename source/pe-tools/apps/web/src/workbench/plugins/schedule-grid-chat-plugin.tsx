import {
  cellSummary,
  readRouteState,
  scheduleGridRouteState,
  splitScheduleCellKey,
} from "@pe/agent-contracts";
import { Link } from "@tanstack/react-router";

import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";
import { CellTrichotomyReviewer } from "../trichotomy-reviewer";

/**
 * Inline chat card + reviewer for the /schedule-grid route. Mirrors FamilyTypesChatPlugin:
 * the compact card shows counts; when active (the authoritative end-of-chat dock) it lists
 * every proposal/staged cell with row + column labels and lets the human approve → stage,
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
    document?.snapshot?.columns.find((column) => column.columnNumber === columnNumber)
      ?.headerText ?? `col ${columnNumber}`;

  return (
    <InlineRoutePlugin title="Schedule Grid" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
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
        />
      ) : null}
    </InlineRoutePlugin>
  );
}
