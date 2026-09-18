import type {
  AgentController,
  AgentControllerDisplayState,
  AvailableModel,
  PermissionRules,
  Session,
  WireDisplayState,
} from "@mastra/core/agent-controller";
import { Buffer } from "node:buffer";
import {
  askExpiryOf,
  threadAccess,
  type CancelledCall,
  type DeferredToolResultRef,
  type ExpiredAsk,
  type ThreadViewState,
  type ToolResultResponse,
  type ToolResultSummary,
} from "@pe/agent-contracts";

export const DEFERRED_TOOL_RESULT_BYTES = 64 * 1024;

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
  const [storedMessages, available] = await Promise.all([
    runtime.controller.queryThreadMessages({ threadId }),
    runtime.controller.listAvailableModels(),
  ]);
  const { messages, deferredResults } = projectThreadMessages(storedMessages);
  const { expiredAsks, cancelledCalls } = await selectEndedCalls(storedMessages, session);
  const permissions = session.permissions.getRules();
  return {
    messages,
    ...(deferredResults.length ? { deferredResults } : {}),
    ...(expiredAsks.length ? { expiredAsks } : {}),
    ...(cancelledCalls.length ? { cancelledCalls } : {}),
    models: { currentId: session.model.get() || undefined, available },
    permissions,
    access: threadAccess(permissions),
    modeId: session.mode.get(),
    inspect: runtime.metadata?.workbench ?? {},
  };
}

type ThreadMessage = Awaited<ReturnType<AgentController["queryThreadMessages"]>>[number];

const askKey = (toolCallId: string) => `ask:${toolCallId}`;
const cancelKey = (toolCallId: string) => `cancelled:${toolCallId}`;
/** Sessions the runtime aborts on its own (host shutdown, a new turn over a parked ask). */
const systemAborts = new WeakSet<object>();

/** An abort that is not a person's cancel: nothing it ends is recorded as cancelled. */
export function abortQuietly(session: Pick<Session, "abort">): void {
  systemAborts.add(session);
  session.abort();
}
/** Each session's in-flight call records, so a read never races the write it depends on. */
const recording = new WeakMap<object, Promise<unknown>>();

/**
 * Records each call's lifetime facts on the thread as they happen, so a read never guesses them
 * from the approval policy or the live state, and a crash loses none of them:
 * - asked: its gate or suspension was raised;
 * - answered: its gate cleared with no abort requested, so a person approved it (an abort on an
 *   armed gate requests the abort first, and that call stays an ask);
 * - cancelled: a person's cancel ended the turn while it ran. An abort the runtime makes itself
 *   (`abortQuietly`: shutdown, a new turn over a parked ask) records no cancel, so a host
 *   restart's calls stay "ended without a terminal result".
 * Returns the unsubscribe.
 */
export function recordCalls(
  session: Pick<Session, "subscribe" | "thread" | "emit" | "run">,
): () => void {
  const running = new Set<string>();
  let armed: string | null = null;
  const write = (key: string, value: boolean) => {
    const threadId = session.thread.getId();
    if (threadId === null) return;
    // In order: a call's later fact (answered) lands after its earlier one (asked).
    const written = (recording.get(session) ?? Promise.resolve()).then(() =>
      session.thread
        .setSettingOn({ threadId, key, value })
        .catch((error: unknown) =>
          session.emit({ type: "error", errorType: "call-record", error: error as Error }),
        ),
    );
    recording.set(session, written);
  };
  return session.subscribe((event) => {
    if (event.type === "tool_start") running.add(event.toolCallId);
    if (event.type === "tool_end") running.delete(event.toolCallId);
    if (event.type === "tool_approval_required") armed = event.toolCallId;
    if (event.type === "tool_approval_required" || event.type === "tool_suspended")
      write(askKey(event.toolCallId), true);
    if (event.type === "display_state_changed" && armed && !event.displayState.pendingApproval) {
      if (!session.run.isAbortRequested()) write(askKey(armed), false);
      armed = null;
    }
    if (event.type !== "agent_end") return;
    const stopped = [...running];
    running.clear();
    armed = null;
    const quiet = systemAborts.delete(session);
    if (event.reason !== "aborted" || quiet) return;
    for (const toolCallId of stopped) write(cancelKey(toolCallId), true);
  });
}

/**
 * Stored calls that never reached a terminal state and that nothing live awaits. One recorded as an
 * ask is an expired ask: turn end, cancel (an abort-declined gate stays `call`, only a human denial
 * is `output-denied`) and host restart all land there. One a person's cancel stopped is a cancelled
 * call. Anything else ended without a terminal result, and the transcript says so.
 */
export async function selectEndedCalls(
  messages: ThreadMessage[],
  session: Pick<Session, "displayState" | "thread">,
): Promise<{ expiredAsks: ExpiredAsk[]; cancelledCalls: CancelledCall[] }> {
  const display = session.displayState.get();
  const live = new Set([
    display.pendingApproval?.toolCallId,
    ...display.pendingSuspensions.keys(),
    ...(display.isRunning ? display.activeTools.keys() : []),
  ]);
  const unfinished = messages.flatMap((message) =>
    message.content.parts.flatMap((part) => {
      if (part.type !== "tool-invocation") return [];
      const { state, toolCallId, toolName } = part.toolInvocation;
      if (state !== "call" && state !== "partial-call") return [];
      if (live.has(toolCallId)) return [];
      return [{ messageId: message.id, toolCallId, toolName }];
    }),
  );
  await recording.get(session);
  const [asked, cancelled] = await Promise.all([
    Promise.all(
      unfinished.map((call) => session.thread.getSetting({ key: askKey(call.toolCallId) })),
    ),
    Promise.all(
      unfinished.map((call) => session.thread.getSetting({ key: cancelKey(call.toolCallId) })),
    ),
  ]);
  return {
    expiredAsks: unfinished.filter((_, at) => asked[at] === true),
    // An ask a cancel ended is an expired ask; a cancelled call is one nobody still had to answer.
    cancelledCalls: unfinished.filter((_, at) => asked[at] !== true && cancelled[at] === true),
  };
}

/** Drops parked resume data and its display mirror, so an expired ask cannot be answered. */
export function expireAsks(
  session: Pick<Session, "suspensions" | "emit">,
  reason: Parameters<typeof askExpiryOf>[0],
): boolean {
  const expiry = askExpiryOf(reason);
  if (expiry === null) return false;
  for (const { toolCallId, toolName } of session.suspensions.clear())
    session.emit({ type: "tool_suspension_cancelled", toolCallId, toolName, reason: expiry });
  return true;
}

/**
 * A new turn over a parked ask expires the ask and cancels the parked run (it ends `aborted`); the
 * run still owns the thread, so a signal sent before its stream detaches is lost. Returns that
 * teardown, undefined when nothing is parked. No timer: an `onBeforeAgentEnd` handler may take as
 * long as it needs, and the run resets before the stream detaches, so only the stream's end counts.
 */
export function endParkedTurn(
  session: Pick<Session, "suspensions" | "emit" | "abort" | "stream">,
): Promise<void> | undefined {
  if (!session.suspensions.hasPending()) return undefined;
  expireAsks(session, "new-turn");
  const torndown = session.stream.isOpen()
    ? session.stream.waitForTeardown(new AbortController().signal)
    : Promise.resolve();
  abortQuietly(session);
  return torndown;
}

export function projectThreadMessages(messages: ThreadMessage[]): {
  messages: ThreadMessage[];
  deferredResults: DeferredToolResultRef[];
} {
  const deferredResults: DeferredToolResultRef[] = [];
  const projected = messages.map((message) => {
    let changed = false;
    const parts = message.content.parts.map((part) => {
      if (part.type !== "tool-invocation") return part;
      const invocation = part.toolInvocation;
      if (invocation.state !== "result" || invocation.isError === true) return part;
      const result = invocation.result;
      if (isValidationFailure(result)) return part;
      const json = JSON.stringify(result);
      if (json === undefined) return part;
      const byteSize = Buffer.byteLength(json, "utf8");
      if (byteSize <= DEFERRED_TOOL_RESULT_BYTES) return part;
      deferredResults.push({
        messageId: message.id,
        toolCallId: invocation.toolCallId,
        byteSize,
        summary: summarizeResult(result),
      });
      const projectedInvocation = { ...invocation };
      delete projectedInvocation.result;
      changed = true;
      return { ...part, toolInvocation: projectedInvocation };
    });
    return changed ? { ...message, content: { ...message.content, parts } } : message;
  });
  return { messages: projected, deferredResults };
}

export async function readToolResult(
  runtime: { controller: Pick<AgentController, "init" | "queryThreadMessages"> },
  threadId: string,
  messageId: string,
  toolCallId: string,
): Promise<
  { status: 200; body: ToolResultResponse } | { status: 404 | 409; body: { error: string } }
> {
  await runtime.controller.init();
  const messages = await runtime.controller.queryThreadMessages({ threadId });
  const matches = messages
    .filter((message) => message.id === messageId)
    .flatMap((message) =>
      message.content.parts.filter(
        (part) => part.type === "tool-invocation" && part.toolInvocation.toolCallId === toolCallId,
      ),
    );
  if (matches.length === 0) return { status: 404, body: { error: "tool result not found" } };
  if (matches.length > 1)
    return { status: 409, body: { error: "tool call identity is ambiguous" } };
  const match = matches[0];
  if (match.type !== "tool-invocation")
    return { status: 404, body: { error: "tool result not found" } };
  const invocation = match.toolInvocation;
  if (!("result" in invocation)) return { status: 404, body: { error: "tool result not found" } };
  return { status: 200, body: { messageId, toolCallId, result: invocation.result } };
}

function summarizeResult(result: unknown): ToolResultSummary {
  if (Array.isArray(result)) return { kind: "array", items: result.length };
  if (result !== null && typeof result === "object") {
    const keys = Object.keys(result);
    return { kind: "object", keyCount: keys.length, keys: keys.slice(0, 8) };
  }
  if (typeof result === "string") return { kind: "string", characters: result.length };
  return { kind: "scalar" };
}

function isValidationFailure(result: unknown): boolean {
  return (
    result !== null &&
    typeof result === "object" &&
    "error" in result &&
    (result as { error?: unknown }).error === true
  );
}
