import type {
  AgentController,
  AgentControllerDisplayState,
  AvailableModel,
  PermissionRules,
  Session,
  WireDisplayState,
} from "@mastra/core/agent-controller";
import { threadAccess, type ThreadViewState } from "@pe/agent-contracts";

type RuntimeThreadViewState = ThreadViewState<
  Awaited<ReturnType<AgentController["queryThreadMessages"]>>[number],
  AvailableModel,
  PermissionRules
>;

export function toWireDisplayState(displayState: AgentControllerDisplayState): WireDisplayState {
  const state = structuredClone(displayState);
  return {
    ...state,
    activeTools: Object.fromEntries(state.activeTools),
    toolInputBuffers: Object.fromEntries(state.toolInputBuffers),
    pendingSuspensions: Object.fromEntries(state.pendingSuspensions),
    activeSubagents: Object.fromEntries(state.activeSubagents),
    modifiedFiles: Object.fromEntries(state.modifiedFiles),
  };
}

export async function readThreadState(
  runtime: {
    controller: Pick<AgentController, "init" | "queryThreadMessages" | "listAvailableModels">;
    metadata?: Record<string, unknown>;
  },
  session: Session,
  threadId: string,
): Promise<RuntimeThreadViewState> {
  await runtime.controller.init();
  const [messages, available] = await Promise.all([
    runtime.controller.queryThreadMessages({ threadId }),
    runtime.controller.listAvailableModels(),
  ]);
  const permissions = session.permissions.getRules();
  return {
    messages,
    models: { currentId: session.model.get() || undefined, available },
    permissions,
    access: threadAccess(permissions),
    modeId: session.mode.get(),
    inspect: runtime.metadata?.workbench ?? {},
  };
}
