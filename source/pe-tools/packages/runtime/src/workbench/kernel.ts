import type { HarnessEvent, HarnessThread } from "@mastra/core/harness";
import { createRunLocks } from "./locks.ts";
import { projectWorkbenchState } from "./projection.ts";
import {
  errorMessage,
  readArray,
  readAccessLevel,
  readRecord,
  readString,
  switchThread,
  threadInfo,
} from "./shared.ts";
import { loadToolIo } from "./tool-io.ts";
import type {
  RuntimeWorkbenchSession,
  WorkbenchAccessLevel,
  WorkbenchContext,
  WorkbenchRunRequest,
  WorkbenchStateOptions,
} from "./types.ts";

const runFrameCap = 200;

export function createWorkbenchKernel(context: WorkbenchContext) {
  const runLocks = createRunLocks();

  return {
    listThreads: () => listThreadSummaries(context),

    async createThread(): Promise<{ threadId: string; state: Record<string, unknown> }> {
      const thread = await context.session.thread.create({ title: "New thread" });
      return { threadId: thread.id, state: await projectWorkbenchState(context, thread.id) };
    },

    async switchThread(threadId: string): Promise<void> {
      await switchThread(context.session, threadId);
    },

    async deleteThread(threadId: string): Promise<void> {
      await context.session.thread.delete({ threadId });
    },

    async forkThread(request: {
      threadId: string;
      messageId?: string;
    }): Promise<{ threadId: string; state: Record<string, unknown> }> {
      const thread = await forkWorkbenchThread(context, request.threadId, request.messageId);
      return { threadId: thread.id, state: await projectWorkbenchState(context, thread.id) };
    },

    async getState(
      threadId?: string,
      options?: WorkbenchStateOptions,
    ): Promise<Record<string, unknown>> {
      // Mastra Session has one active thread; preserve current web behavior by switching before
      // snapshot reads when a caller asks for a specific thread.
      if (threadId) await switchThread(context.session, threadId);
      return projectWorkbenchState(context, threadId, options);
    },

    async run(request: WorkbenchRunRequest): Promise<void> {
      await runWorkbench(context, runLocks, request);
    },

    async resolveApproval(request: {
      threadId?: string;
      requestId?: string;
      optionId?: string;
    }): Promise<Record<string, unknown>> {
      if (request.threadId) await switchThread(context.session, request.threadId);
      await resolveApproval(context.session, request.requestId, request.optionId);
      return projectWorkbenchState(context, request.threadId);
    },

    async setModel(request: {
      threadId?: string;
      modelId?: string;
    }): Promise<Record<string, unknown>> {
      if (request.threadId) await switchThread(context.session, request.threadId);
      if (!request.modelId) throw new Error("Missing modelId.");
      await context.session.model.switch({ modelId: request.modelId });
      return projectWorkbenchState(context, request.threadId);
    },

    async setAccessLevel(request: {
      threadId?: string;
      accessLevel: WorkbenchAccessLevel;
    }): Promise<Record<string, unknown>> {
      if (request.threadId) await switchThread(context.session, request.threadId);
      const accessLevel = readAccessLevel(request.accessLevel);
      await context.session.state.set({ accessLevel, yolo: accessLevel === "trusted" });
      return projectWorkbenchState(context, request.threadId);
    },

    async getToolIo(request: {
      threadId?: string;
      toolCallId: string;
    }): Promise<Record<string, unknown> | null> {
      return loadToolIo(context, request.threadId, request.toolCallId);
    },
  };
}

export type WorkbenchKernel = ReturnType<typeof createWorkbenchKernel>;

async function runWorkbench(
  context: WorkbenchContext,
  runLocks: ReturnType<typeof createRunLocks>,
  request: WorkbenchRunRequest,
): Promise<void> {
  const clientId = request.clientId ?? "unknown";
  const claim = runLocks.acquire(request.threadId, clientId);
  if (!claim.ok) {
    await request.emit({ error: "This thread is already running in another browser tab." });
    return;
  }

  let closed = request.signal?.aborted ?? false;
  let completed = false;
  const onAbort = () => {
    if (completed) return;
    closed = true;
    context.session.abort();
  };
  let unsubscribe: (() => void) | undefined;

  // Conflation pump: events mark the stream dirty; one in-flight loop projects the latest state.
  // The adapter owns socket backpressure. Without this, one event became one full-state frame.
  let eventCount = 0;
  let frameCount = 0;
  const startedAt = Date.now();
  const eventTypes = new Map<string, number>();
  let runaway = false;
  let dirty = false;
  let inFlight: Promise<void> | null = null;

  const runPump = async () => {
    while (dirty && !closed && !runaway) {
      dirty = false;
      const state = await projectWorkbenchState(context, request.threadId, {
        skipOMRefresh: true,
      });
      if (closed) return;
      const payload = { state };
      frameCount++;
      if (frameCount >= runFrameCap) {
        runaway = true;
        console.log(
          `[SAFETY] frame cap ${runFrameCap} hit; eventTypes=${JSON.stringify(Object.fromEntries(eventTypes))}`,
        );
      }
      if (frameCount === 1) {
        for (const [key, value] of Object.entries(state)) {
          console.log(`[SECTION] ${key}=${JSON.stringify(value).length}`);
        }
      }
      await request.emit(payload);
    }
  };

  const markDirty = (): Promise<void> => {
    dirty = true;
    if (!inFlight) {
      inFlight = runPump()
        .catch(() => undefined)
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  try {
    await switchThread(context.session, request.threadId);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    unsubscribe = context.session.subscribe((event) => {
      if (!isWorkbenchRunEvent(event)) return;
      eventCount++;
      eventTypes.set(event.type, (eventTypes.get(event.type) ?? 0) + 1);
      void markDirty();
    });

    void markDirty();
    await context.session.sendMessage({
      content: request.text,
      files: request.attachments,
    });
    // Guarantee a terminal frame with the final state, then drain the pump.
    await markDirty();
  } catch (error) {
    if (!closed) await request.emit({ error: errorMessage(error) });
  } finally {
    console.log(
      `[SUMMARY] events=${eventCount} frames=${frameCount} runaway=${runaway} elapsed=${Date.now() - startedAt}ms eventTypes=${JSON.stringify(Object.fromEntries(eventTypes))}`,
    );
    unsubscribe?.();
    claim.lease.release();
    completed = true;
    request.signal?.removeEventListener("abort", onAbort);
  }
}

function isWorkbenchRunEvent(event: HarnessEvent): boolean {
  return (
    event.type === "display_state_changed" ||
    event.type === "message_start" ||
    event.type === "message_update" ||
    event.type === "message_end" ||
    event.type === "tool_start" ||
    event.type === "tool_update" ||
    event.type === "tool_end" ||
    event.type === "tool_approval_required" ||
    event.type === "tool_suspended" ||
    event.type === "agent_end" ||
    event.type === "error"
  );
}

async function listThreadSummaries(context: WorkbenchContext): Promise<Record<string, unknown>[]> {
  const threads = await context.session.thread.list();
  const cwd = context.runtime.workspace?.cwd;
  // Mastra's thread.list() returns threads across all resourceIds, but switch/getThreadById is
  // resourceId-scoped. Keep the palette to threads this session can actually open.
  const currentThreadId = context.session.thread.getId();
  const currentResourceId = threads.find((thread) => thread.id === currentThreadId)?.resourceId;
  const scoped = currentResourceId
    ? threads.filter((thread) => thread.resourceId === currentResourceId)
    : threads;
  return scoped.map((thread) => ({
    ...threadInfo(thread, cwd),
    id: thread.id,
    messageCount: 0,
    persisted: true,
    promptActive: thread.id === currentThreadId && context.session.displayState.get().isRunning,
  }));
}

async function resolveApproval(
  session: RuntimeWorkbenchSession,
  requestId: string | undefined,
  optionId: string | undefined,
): Promise<void> {
  if (!requestId) throw new Error("Missing requestId.");
  const reject = optionId?.startsWith("reject") ?? false;
  if (requestId.startsWith("tool-suspended:")) {
    const toolCallId = requestId.slice("tool-suspended:".length);
    const pending = session.displayState.get().pendingSuspensions.get(toolCallId);
    await session.respondToToolSuspension({
      toolCallId,
      resumeData: resumeDataForSuspension(pending?.toolName, pending?.suspendPayload, reject),
    });
    return;
  }
  const toolCallId = requestId.startsWith("tool-approval:")
    ? requestId.slice("tool-approval:".length)
    : requestId;
  session.respondToToolApproval({
    toolCallId,
    decision: reject ? "decline" : "approve",
    ...(reject ? { declineContext: { reason: "Rejected from workbench." } } : {}),
  });
}

function resumeDataForSuspension(
  toolName: string | undefined,
  payload: unknown,
  reject: boolean,
): unknown {
  if (toolName === "submit_plan") {
    return reject
      ? { action: "rejected", feedback: "Rejected from workbench." }
      : { action: "approved" };
  }
  if (reject) return "Rejected";
  const options = readArray(readRecord(payload).options);
  const first = options.map((option) => readString(option)).find(Boolean);
  return first ?? "Approved";
}

/**
 * Fork = branch a thread at the clicked turn, not a whole-thread copy. Clone through
 * `@mastra/memory` so observational memory is remapped onto the fork.
 */
async function forkWorkbenchThread(
  context: WorkbenchContext,
  sourceThreadId: string,
  messageId: string | undefined,
): Promise<{ id: string }> {
  const title = nextForkTitle(await context.session.thread.list(), sourceThreadId);
  const memory = context.runtime.memory;
  if (!memory) return context.session.thread.clone({ sourceThreadId, title });
  // ponytail: a same-millisecond sibling of the clicked turn would sneak in; real user turns are
  // seconds apart. Switch to messageFilter.messageIds if that bites.
  const endDate = messageId
    ? await forkPointDate(context.session, sourceThreadId, messageId)
    : undefined;
  const { thread } = await memory.cloneThread({
    sourceThreadId,
    title,
    ...(endDate ? { options: { messageFilter: { endDate } } } : {}),
  });
  await switchThread(context.session, thread.id);
  return thread;
}

/** Timestamp of the clicked turn, used as the clone's inclusive `endDate` cutoff. */
async function forkPointDate(
  session: RuntimeWorkbenchSession,
  threadId: string,
  messageId: string,
): Promise<Date | undefined> {
  const messages = await session.thread.listMessages({ threadId });
  const date = messages.find((message) => message.id === messageId)?.createdAt;
  if (!date) return undefined;
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `<base> (Fork N)` where N is one past the highest existing fork of the same base title. */
export function nextForkTitle(threads: HarnessThread[], sourceThreadId: string): string {
  const source = threads.find((thread) => thread.id === sourceThreadId);
  const base = (source?.title?.trim() || "Thread").replace(/ \(Fork \d+\)$/, "");
  const prefix = `${base} (Fork `;
  let max = 0;
  for (const thread of threads) {
    const title = thread.title?.trim();
    if (!title?.startsWith(prefix) || !title.endsWith(")")) continue;
    const n = Number(title.slice(prefix.length, -1));
    if (Number.isInteger(n)) max = Math.max(max, n);
  }
  return `${prefix}${max + 1})`;
}
