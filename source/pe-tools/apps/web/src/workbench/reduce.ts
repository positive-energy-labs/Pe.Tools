import {
  selectPendingApprovals,
  type WorkbenchState,
} from "@pe/agent-contracts";

import { applyWireEvent } from "./adapter";
import type { WireEvent, WireMessageContent } from "./wire";

export type WorkbenchUpdate =
  | { type: "hydrate"; state: WorkbenchState }
  | { type: "wire"; event: WireEvent }
  | { type: "send"; id: string; content: WireMessageContent[] }
  | { type: "end" }
  | { type: "approval"; requestId: string; optionId?: string }
  | { type: "model"; modelId: string }
  | { type: "access"; accessLevel: WorkbenchState["access"]["currentAccessLevel"] };

export function reduceWorkbench(state: WorkbenchState, update: WorkbenchUpdate): WorkbenchState {
  switch (update.type) {
    case "hydrate":
      return update.state;
    case "wire":
      return applyWireEvent(state, update.event);
    case "send":
      return {
        ...applyWireEvent(state, {
          type: "message_start",
          message: { id: update.id, role: "user", content: update.content },
        }),
        uiStatus: {
          ...state.uiStatus,
          overall: { ...state.uiStatus.overall, status: "running" },
        },
      };
    case "end":
      return applyWireEvent(state, { type: "agent_end" });
    case "approval":
      return {
        ...state,
        approvals: {
          requests: state.approvals.requests.map((request) =>
            request.requestId === update.requestId
              ? { ...request, status: "resolved", selectedOptionId: update.optionId }
              : request,
          ),
        },
      };
    case "model":
      return { ...state, models: { ...state.models, currentModelId: update.modelId } };
    case "access":
      return { ...state, access: { ...state.access, currentAccessLevel: update.accessLevel } };
  }
}

export function runEndedCleanly(state: WorkbenchState, event: WireEvent): boolean {
  return (
    event.type === "agent_end" &&
    event.reason !== "suspended" &&
    selectPendingApprovals(state).length === 0
  );
}
