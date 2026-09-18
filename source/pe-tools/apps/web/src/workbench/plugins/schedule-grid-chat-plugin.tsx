import { splitScheduleCellKey, scheduleReadingSchema } from "@pe/agent-contracts";
import { LiveScheduleGridWorkspace } from "#/route/schedules/live";
import type { ScheduleGridState } from "#/route/schedules/workspace";
import { useThreadScope } from "#/chat/scope";
import { useWorkbench } from "../provider";
import {
  reviewAddresses,
  reviewCommit,
  discardStaged,
  type CellWire,
  ReviewRow,
  WorkBand,
} from "#/components/lang/band";
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
          thread={currentThreadId}
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
  const items = reviewAddresses(state.slice?.cells ?? {});
  const staged = items.filter(([, cell]) => cell.staged != null);
  const cells = state.slice?.cells ?? {};
  const wire: CellWire = { segment: "cells", write: state.apply, revision: state.revision };
  const busy = state.busy != null;
  return (
    <WorkBand
      count={staged.length}
      noun="cell"
      revision={state.revision}
      busy={busy}
      visible={items.length > 0}
      discard={() => void discardStaged(wire, cells).catch(() => undefined)}
      commit={reviewCommit(
        `Push ${staged.length} to Revit`,
        staged.length,
        () => void state.execute("push").catch(() => undefined),
        state.blockedBecause,
      )}
      unresolved={state.failure ? [state.failure.message] : []}
      body={items.map(([key, cell]) => {
        const { rowNumber, columnNumber } = splitScheduleCellKey(key);
        const row = snapshot?.rows.find((r) => r.rowNumber === rowNumber);
        const to = (cell.staged ?? cell.proposal)?.value;
        return (
          <ReviewRow
            key={key}
            wire={wire}
            address={key}
            label={`${snapshot?.columns.find((c) => c.columnNumber === columnNumber)?.headerText ?? columnNumber} · row ${rowNumber}`}
            cell={cell}
            facts={{
              value: (
                <ValueDiff
                  from={
                    row?.bindings.find((b) => b.columnNumber === columnNumber)?.displayValue ?? null
                  }
                  to={typeof to === "string" ? to : JSON.stringify(to ?? "")}
                />
              ),
            }}
          />
        );
      })}
    />
  );
}
