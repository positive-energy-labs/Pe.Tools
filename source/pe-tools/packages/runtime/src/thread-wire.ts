import type {
  AgentController,
  AgentControllerDisplayState,
  AgentControllerEvent,
  AvailableModel,
  JsonReadyAgentControllerEvent,
  PermissionRules,
  Session,
  WireDisplayState,
} from "@mastra/core/agent-controller";

/**
 * The thread ledger's snapshot: the whole client chat state at one host seq. Emitted into the ring
 * on a reset so every later event orders after it. Ledger 2026-09-02 CHAT LEDGER SHAPE (agent).
 */
export interface ThreadSnapshot {
  type: "snapshot";
  display: WireDisplayState;
  messages: Awaited<ReturnType<AgentController["queryThreadMessages"]>>;
  models: { currentId?: string; available: AvailableModel[] };
  permissions: PermissionRules;
  inspect: unknown;
}

export type ThreadWireEvent = JsonReadyAgentControllerEvent | ThreadSnapshot;

// Copied from @mastra/server's SSE handler (`toWireDisplayState`): display-state Maps JSON-serialize
// to `{}`; snapshot before converting so a queued entry keeps point-in-time state. The one vendor
// internal this ledger mirrors; `WireDisplayState` from core types it, so a bump that changes the
// shape fails here at compile time.
function toWireDisplayState(displayState: AgentControllerDisplayState): WireDisplayState {
  const snapshot = structuredClone(displayState);
  return {
    ...snapshot,
    activeTools: Object.fromEntries(snapshot.activeTools),
    toolInputBuffers: Object.fromEntries(snapshot.toolInputBuffers),
    pendingSuspensions: Object.fromEntries(snapshot.pendingSuspensions),
    activeSubagents: Object.fromEntries(snapshot.activeSubagents),
    modifiedFiles: Object.fromEntries(snapshot.modifiedFiles),
  };
}

/** A controller event as JSON can carry it, copied at ingress: message events share one live mutable message. */
export function toWireEvent(event: AgentControllerEvent): JsonReadyAgentControllerEvent {
  if ("displayState" in event) {
    return { ...event, displayState: toWireDisplayState(event.displayState) };
  }
  if ("error" in event && event.error instanceof Error) {
    const error = { name: event.error.name, message: event.error.message };
    return { ...event, error } as JsonReadyAgentControllerEvent;
  }
  if ("message" in event && typeof event.message === "object") {
    return { ...event, message: structuredClone(event.message) } as JsonReadyAgentControllerEvent;
  }
  return event as JsonReadyAgentControllerEvent;
}

export async function threadSnapshot(
  runtime: {
    controller: Pick<AgentController, "init" | "queryThreadMessages" | "listAvailableModels">;
    metadata?: Record<string, unknown>;
  },
  session: Session,
  threadId: string,
  limit: number,
): Promise<ThreadSnapshot> {
  await runtime.controller.init();
  const [messages, available] = await Promise.all([
    runtime.controller.queryThreadMessages({ threadId, limit }),
    runtime.controller.listAvailableModels(),
  ]);
  return {
    type: "snapshot",
    display: toWireDisplayState(session.displayState.get()),
    messages,
    models: { currentId: session.model.get() || undefined, available },
    permissions: session.permissions.getRules(),
    inspect: runtime.metadata?.workbench ?? {},
  };
}
