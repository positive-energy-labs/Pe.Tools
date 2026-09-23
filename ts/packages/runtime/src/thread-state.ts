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
/** Why a run ended in error, and the calls it left running; keyed by run. */
export const turnEndKey = (runId: string) => `turn-end:${runId}`;
/** Sessions the runtime aborts on its own (host shutdown, a new turn over a parked ask). */
const systemAborts = new WeakSet<object>();

/** An abort that is not a person's cancel: nothing it ends is recorded as cancelled. */
export function abortQuietly(session: Pick<Session, "abort" | "run">): void {
  // Only a running turn ends from an abort; marking an idle one would outlive it.
  if (session.run.isRunning()) systemAborts.add(session);
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
 * - turn end: a run that ends in error records its last error and the calls it left running
 *   (`turnEndKey`), so a turn that failed around a live call says why (F-H6-8).
 * Returns the unsubscribe.
 */
export function recordCalls(
  session: Pick<Session, "subscribe" | "thread" | "emit" | "run">,
): () => void {
  const running = new Set<string>();
  let armed: string | null = null;
  let lastError: string | null = null;
  const write = (key: string, value: unknown) => {
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
    if (event.type === "agent_start") lastError = null;
    if (event.type === "error") lastError = event.error.message;
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
    const runId = session.run.getRunId();
    if (event.reason === "error" && runId)
      write(turnEndKey(runId), { reason: "error", error: lastError, running: stopped });
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
  session: Pick<Session, "displayState" | "suspensions" | "thread">,
): Promise<{ expiredAsks: ExpiredAsk[]; cancelledCalls: CancelledCall[] }> {
  const display = session.displayState.get();
  const live = new Set([
    display.pendingApproval?.toolCallId,
    ...[...display.pendingSuspensions.keys()].filter((toolCallId) =>
      session.suspensions.has({ toolCallId }),
    ),
    ...(display.isRunning ? display.activeTools.keys() : []),
  ]);
  const unfinished = messages.flatMap((message) =>
    message.content.parts.flatMap((part) => {
      if (part.type !== "tool-invocation") return [];
      const { state, toolCallId, toolName } = part.toolInvocation;
      // An ask a new turn ended is stored with the unanswered result; it is still an ended ask.
      const unanswered = state === "result" && isExpiredResult(part.toolInvocation.result);
      if (state !== "call" && state !== "partial-call" && !unanswered) return [];
      if (live.has(toolCallId)) return [];
      const suspended = message.content.metadata?.suspendedTools as
        | Record<string, unknown>
        | undefined;
      return [
        { messageId: message.id, toolCallId, toolName, suspended: toolCallId in (suspended ?? {}) },
      ];
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
    expiredAsks: unfinished
      .filter((call, at) => call.suspended || asked[at] === true)
      .map(({ suspended: _, ...call }) => call),
    // An ask a cancel ended is an expired ask; a cancelled call is one nobody still had to answer.
    cancelledCalls: unfinished
      .filter((call, at) => !call.suspended && asked[at] !== true && cancelled[at] === true)
      .map(({ suspended: _, ...call }) => call),
  };
}

/** Drops parked resume data and its display mirror, so an expired ask cannot be answered. */
export function expireAsks(
  session: Pick<Session, "suspensions" | "emit">,
  reason: Parameters<typeof askExpiryOf>[0],
): { toolCallId: string; toolName: string }[] | null {
  const expiry = askExpiryOf(reason);
  if (expiry === null) return null;
  const expired = session.suspensions.clear();
  for (const { toolCallId, toolName } of expired)
    session.emit({ type: "tool_suspension_cancelled", toolCallId, toolName, reason: expiry });
  return expired;
}

/**
 * What an ask a new turn ended reads as, in the stored transcript and in the next turn's model
 * context: unanswered, never rejected and never silently dropped (journeys, E2E-J5).
 */
const EXPIRED_UNANSWERED = {
  expired: "unanswered",
  note: "The person sent a new message instead of answering.",
} as const;
const isExpiredResult = (result: unknown) =>
  typeof result === "object" &&
  result !== null &&
  (result as { expired?: unknown }).expired === EXPIRED_UNANSWERED.expired;

/**
 * Persists the expiry of asks a new turn ended: each stored call gets the unanswered result and
 * loses its parked-suspension metadata, so a reload reads it expired and the next turn's model sees
 * its question went unanswered. The message is re-saved whole; storage upserts it by id.
 */
async function persistExpiredAsks(
  session: Pick<Session, "thread" | "machinery">,
  toolCallIds: readonly string[],
): Promise<void> {
  if (!toolCallIds.length) return;
  // Both hold in the product: admission requires the thread, and Pea's storage is LibSQL, whose
  // memory store holds the transcript. A silent skip would reload the ask live (F-J5-2).
  const threadId = session.thread.getId();
  if (!threadId) throw new Error("Cannot record the expired ask: the session has no thread.");
  const memory = await session.machinery
    .getAgent()
    .getMastraInstance()
    ?.getStorage()
    ?.getStore("memory");
  if (!memory) throw new Error("Cannot record the expired ask: the runtime has no memory store.");
  const expired = new Set(toolCallIds);
  const { messages } = await memory.listMessages({ threadId });
  const changed = messages.flatMap((message) => {
    let touched = false;
    const parts = message.content.parts.map((part) => {
      if (part.type !== "tool-invocation" || !expired.has(part.toolInvocation.toolCallId))
        return part;
      touched = true;
      return {
        ...part,
        toolInvocation: {
          ...part.toolInvocation,
          state: "result" as const,
          result: EXPIRED_UNANSWERED,
        },
      };
    });
    if (!touched) return [];
    const metadata = { ...message.content.metadata } as Record<string, unknown>;
    for (const key of ["suspendedTools", "pendingToolApprovals"]) {
      const parked = { ...(metadata[key] as Record<string, unknown> | undefined) };
      for (const toolCallId of expired) delete parked[toolCallId];
      if (Object.keys(parked).length) metadata[key] = parked;
      else delete metadata[key];
    }
    return [{ ...message, content: { ...message.content, parts, metadata } }];
  });
  if (changed.length) await memory.saveMessages({ messages: changed as never });
}

/**
 * A new turn over a parked ask expires the ask and cancels the parked run (it ends `aborted`); the
 * run still owns the thread, so a signal sent before its stream detaches is lost. Returns that
 * teardown, undefined when nothing is parked. No timer: an `onBeforeAgentEnd` handler may take as
 * long as it needs, and the run resets before the stream detaches, so only the stream's end counts.
 */
export function endParkedTurn(
  session: Pick<
    Session,
    "suspensions" | "emit" | "abort" | "stream" | "run" | "thread" | "machinery"
  >,
): Promise<void> | undefined {
  if (!session.suspensions.hasPending()) return undefined;
  const expired = expireAsks(session, "new-turn") ?? [];
  const waiting = new AbortController();
  const teardown = session.stream.isOpen()
    ? session.stream.waitForTeardown(waiting.signal).catch(() => undefined)
    : Promise.resolve();
  abortQuietly(session);
  // A parked run that already detached is released at once, with no abort armed (the Mastra
  // patch): its stream stays, so there is no teardown to wait out.
  if (!session.run.isAbortRequested()) waiting.abort();
  return teardown.then(() =>
    persistExpiredAsks(
      session,
      expired.map((ask) => ask.toolCallId),
    ),
  );
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
