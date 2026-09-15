import { splitScheduleCellKey, scheduleReadingSchema } from "@pe/agent-contracts";
import { LiveScheduleGridWorkspace } from "#/schedule-grid/live";
import type { ScheduleGridState } from "#/schedule-grid/workspace";
import { useThreadScope } from "#/chat/scope";
import { useWorkbench } from "../provider";
import { CellTrichotomyReviewer } from "../trichotomy-reviewer";
import { InlineRoutePlugin } from "../route-chat-plugins";
import type { RouteChatPluginViewProps } from "../route-chat-plugins/tool-names";
import { ValueDiff } from "#/components/lang/value-diff";

export function ScheduleGridChatPlugin({ args, sessionState }: RouteChatPluginViewProps) {
  const { currentThreadId } = useWorkbench();
  const thread = useThreadScope(currentThreadId);
  const request = args as {
    workspaceId?: string;
    input?: { bases?: { work?: { scope?: { workspaceId?: string } } } };
  } | null;
  const returned =
    sessionState && typeof sessionState === "object" && "result" in sessionState
      ? sessionState.result
      : sessionState;
  const workspaceId =
    request?.workspaceId ??
    request?.input?.bases?.work?.scope?.workspaceId ??
    scheduleReadingSchema.safeParse(returned).data?.workspaceId;
  if (!thread.hydrated) return null;
  return (
    <InlineRoutePlugin title="Schedule Grid" action="Review staged edits">
      {workspaceId ? (
        <LiveScheduleGridWorkspace
          key={workspaceId}
          workspaceId={workspaceId}
          render={(state) => <ScheduleGridReview state={state} />}
        />
      ) : (
        <span>Open the Schedule Grid pane and select a schedule to review its Work.</span>
      )}
    </InlineRoutePlugin>
  );
}
export function ScheduleGridReview({ state }: { state: ScheduleGridState }) {
  const snapshot = state.snapshot;
  return (
    <CellTrichotomyReviewer
      state={state}
      segment="cells"
      cells={state.slice?.cells ?? {}}
      onCommit={() => state.execute("push")}
      commitBlocked={state.blockedBecause ?? undefined}
      commitLabel={(count) => `Push ${count} to Revit`}
      reviewHint="Only a human can apply reviewed cells."
      renderLabel={(key) => {
        const { rowNumber, columnNumber } = splitScheduleCellKey(key);
        return `${snapshot?.columns.find((c) => c.columnNumber === columnNumber)?.headerText ?? columnNumber} · row ${rowNumber}`;
      }}
      renderValue={(value, key) => {
        const { rowNumber, columnNumber } = splitScheduleCellKey(key);
        const row = snapshot?.rows.find((r) => r.rowNumber === rowNumber);
        return (
          <ValueDiff
            from={row?.bindings.find((b) => b.columnNumber === columnNumber)?.displayValue ?? null}
            to={typeof value === "string" ? value : JSON.stringify(value ?? "")}
          />
        );
      }}
    />
  );
}
