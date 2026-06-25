import fs from "node:fs/promises";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  AvailableModel,
  HarnessThread,
  HarnessDisplayState,
  HarnessMessage,
  HarnessMessageContent,
  Session,
} from "@mastra/core/harness";
import {
  buildContextBreakdown,
  estimateTokens,
  type ContextBreakdownSkill,
  type ContextBreakdownTool,
} from "./context-breakdown.ts";
import { createRuntimeLocalTransportAuth, type RuntimeLocalTransportAuth } from "./transport.ts";
import type { RuntimeWorkspaceInfo } from "./runtime.ts";

export interface RuntimeWorkbenchWebOptions<TRuntimeOptions = unknown> {
  label: string;
  title?: string;
  createRuntime: (options: TRuntimeOptions) => Promise<unknown>;
  runtimeOptions?: TRuntimeOptions;
  host?: string;
  port?: number;
  staticDir?: string;
  workbenchPort?: number;
  workbenchToken?: string;
}

type RuntimeWorkbenchSession = Session<any>;
interface RuntimeWorkbenchHarness {
  listAvailableModels(): Promise<AvailableModel[]>;
  listModes(): Array<{ id: string; name: string }>;
}

/** Minimal slice of `@mastra/memory` Memory the fork path needs: a partial clone that
 *  also remaps observational memory (raw storage.cloneThread would drop OM). */
interface RuntimeWorkbenchMemory {
  cloneThread(args: {
    sourceThreadId: string;
    resourceId?: string;
    title?: string;
    options?: { messageFilter?: { endDate?: Date; messageIds?: string[] } };
  }): Promise<{ thread: { id: string } }>;
}

interface RuntimeWorkbenchHandle {
  harness: RuntimeWorkbenchHarness;
  session?: RuntimeWorkbenchSession;
  memory?: RuntimeWorkbenchMemory;
  workspace?: RuntimeWorkspaceInfo;
  metadata?: Record<string, unknown>;
  close?: () => Promise<void> | void;
}

interface NativeBreakdownMeta {
  tools: ContextBreakdownTool[];
  systemPromptText?: string;
  skills: ContextBreakdownSkill[];
}

interface WebRuntime {
  label: string;
  title: string;
  runtime: RuntimeWorkbenchHandle;
  session: RuntimeWorkbenchSession;
  activeRuns: Map<string, string>;
  /** Cached native breakdown inputs (tools+schemas, system prompt), keyed by mode. */
  nativeMeta?: { modeId?: string; promise: Promise<NativeBreakdownMeta | undefined> };
}

function requireRuntimeWorkbenchHandle(value: unknown): RuntimeWorkbenchHandle {
  const runtime = readRecord(value);
  const harness = readRecord(runtime.harness);
  if (
    typeof harness.listAvailableModels !== "function" ||
    typeof harness.listModes !== "function"
  ) {
    throw new Error("Runtime workbench web requires a harness with model and mode listing.");
  }
  return value as RuntimeWorkbenchHandle;
}

export async function runRuntimeWorkbenchWeb<TRuntimeOptions = unknown>(
  options: RuntimeWorkbenchWebOptions<TRuntimeOptions>,
): Promise<void> {
  const runtime = requireRuntimeWorkbenchHandle(
    await options.createRuntime((options.runtimeOptions ?? {}) as TRuntimeOptions),
  );
  const session = runtime.session;
  if (!session) throw new Error(`Expected ${options.label} runtime session.`);

  const label = options.label;
  const title = options.title ?? label;
  const host = options.host ?? "127.0.0.1";
  const workbenchPort = options.workbenchPort ?? 43112;
  const auth = createRuntimeLocalTransportAuth({
    token: options.workbenchToken ?? process.env.PE_WORKBENCH_DEV_TOKEN ?? "dev-loopback",
    headerNames: ["x-runtime-workbench-token", "x-runtime-local-token", "x-pea-local-token"],
  });
  const webRuntime: WebRuntime = { label, title, runtime, session, activeRuns: new Map() };
  const workbenchServer = createServer(
    (request, response) => void handleWorkbenchRequest(webRuntime, auth, request, response),
  );
  await listen(workbenchServer, host, workbenchPort);
  const workbenchUrl = `http://${host}:${addressPort(workbenchServer)}?token=${encodeURIComponent(auth.token)}`;

  let appServer: ReturnType<typeof createServer> | undefined;
  let appUrl: string | undefined;
  if (options.staticDir) {
    appServer = createServer(
      (request, response) =>
        void handleStaticRequest(options.staticDir!, workbenchUrl, request, response),
    );
    await listen(appServer, host, options.port ?? 0);
    appUrl = `http://${host}:${addressPort(appServer)}?workbench=${encodeURIComponent(workbenchUrl)}`;
  }

  console.log(`${label} workbench API ${workbenchUrl}`);
  if (appUrl) console.log(`${label} website ${appUrl}`);

  await waitForShutdown(async () => {
    await Promise.all([
      appServer ? closeHttpServer(appServer) : Promise.resolve(),
      closeHttpServer(workbenchServer),
      runtime.close?.() ?? Promise.resolve(),
    ]);
  });
}
async function handleWorkbenchRequest(
  web: WebRuntime,
  auth: RuntimeLocalTransportAuth,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  setCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (!url.pathname.startsWith("/workbench")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  if (!auth.isAuthorized(request, url)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/workbench/threads") {
      sendJson(response, 200, { threads: await listThreadSummaries(web) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/threads") {
      const thread = await web.session.thread.create({ title: "New thread" });
      sendJson(response, 200, {
        threadId: thread.id,
        state: await projectWorkbenchState(web, thread.id),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/workbench/state") {
      const threadId = url.searchParams.get("threadId") ?? web.session.thread.getId();
      if (!threadId) throw new Error("No active thread.");
      await switchThread(web.session, threadId);
      sendJson(response, 200, { state: await projectWorkbenchState(web, threadId) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/workbench/hydrate") {
      const threadId = url.searchParams.get("threadId") ?? web.session.thread.getId();
      if (!threadId) throw new Error("No active thread.");
      await switchThread(web.session, threadId);
      sendJson(response, 200, { state: await projectWorkbenchState(web, threadId) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/run") {
      await handleRun(web, request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/approve") {
      const body = await readJsonBody(request);
      const threadId = readString(body.threadId) ?? web.session.thread.getId();
      if (threadId) await switchThread(web.session, threadId);
      await resolveApproval(web.session, readString(body.requestId), readString(body.optionId));
      sendJson(response, 200, { state: await projectWorkbenchState(web, threadId ?? undefined) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/model") {
      const body = await readJsonBody(request);
      const threadId = readString(body.threadId);
      if (threadId) await switchThread(web.session, threadId);
      const modelId = readString(body.modelId);
      if (!modelId) throw new Error("Missing modelId.");
      await web.session.model.switch({ modelId });
      sendJson(response, 200, { state: await projectWorkbenchState(web, threadId) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/access") {
      const body = await readJsonBody(request);
      const threadId = readString(body.threadId);
      if (threadId) await switchThread(web.session, threadId);
      const accessLevel = readAccessLevel(body.accessLevel);
      await web.session.state.set({ accessLevel, yolo: accessLevel === "trusted" });
      sendJson(response, 200, { state: await projectWorkbenchState(web, threadId) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/workbench/fork") {
      const body = await readJsonBody(request);
      const sourceThreadId = readString(body.threadId) ?? web.session.thread.getId();
      if (!sourceThreadId) throw new Error("No thread to fork.");
      const thread = await forkWorkbenchThread(web, sourceThreadId, readString(body.messageId));
      sendJson(response, 200, {
        threadId: thread.id,
        state: await projectWorkbenchState(web, thread.id),
      });
      return;
    }
    const deleteMatch = /^\/workbench\/threads\/([^/]+)$/.exec(url.pathname);
    if (request.method === "DELETE" && deleteMatch) {
      await web.session.thread.delete({ threadId: decodeURIComponent(deleteMatch[1]!) });
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: errorMessage(error) });
  }
}

async function handleRun(
  web: WebRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const threadId = readString(body.threadId) ?? web.session.thread.getId();
  if (!threadId) throw new Error("Missing threadId.");
  const clientId = readString(body.clientId) ?? "unknown";
  const owner = web.activeRuns.get(threadId);
  if (owner && owner !== clientId) {
    writeSseHeaders(response);
    writeSse(response, { error: "This thread is already running in another browser tab." });
    response.end();
    return;
  }

  await switchThread(web.session, threadId);
  web.activeRuns.set(threadId, clientId);
  writeSseHeaders(response);

  let closed = false;
  let completed = false;
  response.on("close", () => {
    if (completed) return;
    closed = true;
    web.session.abort();
  });

  let queue = Promise.resolve();
  const emit = () => {
    queue = queue
      .then(async () => {
        if (!closed) writeSse(response, { state: await projectWorkbenchState(web, threadId) });
      })
      .catch(() => undefined);
  };
  const unsubscribe = web.session.subscribe((event) => {
    if (
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
    ) {
      emit();
    }
  });

  try {
    emit();
    await web.session.sendMessage({
      content: readString(body.text) ?? "",
      files: readAttachments(readArray(body.attachments)),
    });
    await queue;
    if (!closed) writeSse(response, { state: await projectWorkbenchState(web, threadId) });
  } catch (error) {
    if (!closed) writeSse(response, { error: errorMessage(error) });
  } finally {
    unsubscribe();
    web.activeRuns.delete(threadId);
    completed = true;
    if (!closed) response.end();
  }
}

async function projectWorkbenchState(
  web: WebRuntime,
  threadIdInput?: string,
): Promise<Record<string, unknown>> {
  const session = web.session;
  const threadId = threadIdInput ?? session.thread.getId();
  const [threads, availableModels] = await Promise.all([
    session.thread.list(),
    web.runtime.harness.listAvailableModels().catch((): AvailableModel[] => []),
  ]);
  const messages = threadId ? await session.thread.listMessages({ threadId }) : [];
  // Native OM refresh: reconstruct omProgress (real message/observation tokens + config thresholds)
  // from the stored OM record so the memory windows populate on thread load, not only after a run.
  await loadOMProgressSafe(web);
  const observationText = await loadObservationTextSafe(web);
  const displayState = session.displayState.get();
  const allMessages = mergeCurrentMessage(messages, displayState);
  const workbench = readRecord(web.runtime.metadata?.workbench);
  // Native-first: read tools (with schemas) and the resolved system prompt straight from the
  // mastra agent. Falls back to pea's metadata.workbench shims when accessors are unavailable.
  const native = await resolveNativeBreakdownMeta(web);
  const harnessState = readRecord(session.state.get());
  const accessLevel = readAccessLevel(
    harnessState.accessLevel ?? (harnessState.yolo === true ? "trusted" : "ask"),
  );
  const tools = collectTools(allMessages, displayState);

  return {
    agent: {
      info: {
        name: web.label,
        title: web.title,
        capabilities: {
          threads: true,
          history: true,
          toolCalls: true,
          approvals: true,
          plans: true,
          rawToolIO: true,
          modelSwitching: true,
          sessionModes: true,
          accessLevels: true,
          observationalMemory: true,
          systemPromptInspection: true,
        },
        metadata: {
          commands: readArray(workbench.skills).map((skill) => ({
            name: readString(readRecord(skill).name) ?? "skill",
            description: readString(readRecord(skill).description) ?? "skill",
          })),
        },
      },
      session: {
        sessionId: session.identity.getId(),
        cwd: readString(web.runtime.workspace?.cwd) ?? process.cwd(),
        title: currentThreadTitle(threads, threadId),
        updatedAt: new Date().toISOString(),
      },
    },
    threads: {
      items: threads.map((thread) => threadInfo(thread, web.runtime.workspace?.cwd)),
      activeThreadId: threadId,
      selectedThreadId: threadId,
      status: "loaded",
    },
    transcript: {
      messages: allMessages.map((message) => workbenchMessage(message, displayState)),
      status: "loaded",
    },
    tools: {
      calls: tools,
      activeToolCallIds: activeToolIds(displayState),
      recentToolCallIds: tools
        .slice(-20)
        .map((tool) => readString(readRecord(tool).id))
        .filter(Boolean),
      rawIoAvailable: true,
    },
    approvals: { requests: approvalRequests(displayState, web.label) },
    plans: {
      entries: displayState.tasks.map((task) => ({
        id: task.id,
        content: task.content,
        status: task.status,
      })),
    },
    models: {
      currentModelId: session.model.get() || readString(harnessState.currentModelId),
      availableModels: modelInfos(availableModels, readArray(workbench.availableModels)),
      recentModelIds: [],
    },
    modes: {
      currentModeId: session.mode.get(),
      availableModes: web.runtime.harness
        .listModes()
        .map((mode) => ({ id: mode.id, name: mode.name })),
    },
    access: {
      currentAccessLevel: accessLevel,
      availableAccessLevels: [
        { id: "read-only", name: "Read-only", description: "Block workspace changes." },
        { id: "ask", name: "Ask", description: "Ask before tools that change state." },
        { id: "trusted", name: "Trusted", description: "Run trusted workspace tools directly." },
      ],
    },
    memory: { entries: memoryEntries(displayState, workbench) },
    inspector: {
      systemPrompt:
        native?.systemPromptText !== undefined
          ? { content: native.systemPromptText, source: "resolved · agent.getInstructions" }
          : systemPromptSnapshot(workbench.systemPrompt),
      contextBreakdown: {
        ...buildContextBreakdown({
          contextWindow: readNumber(workbench.contextWindow),
          systemPromptText:
            native?.systemPromptText ?? readString(readRecord(workbench.systemPrompt).content),
          // Native: the full merged tool set with input/output schemas, read from the live agent
          // (agent.getToolsForExecution). Falls back to pea's captured toolList snapshot.
          tools: native?.tools ?? contextBreakdownTools(workbench.toolList),
          messages: allMessages.map((message) => ({
            role: message.role,
            text: messageText(message),
          })),
          // Native skills (agent.listSkills) when available; else pea's published skill payload.
          skills:
            native && native.skills.length > 0
              ? native.skills
              : readArray(workbench.skills).map((skill) => ({
                  name: readString(readRecord(skill).name) ?? "skill",
                  description: readString(readRecord(skill).description),
                  // Full skill markdown (when the runtime publishes it) becomes the expandable card.
                  body: readString(readRecord(skill).content) ?? readString(readRecord(skill).body),
                  approxTokens: readNumber(readRecord(skill).approxTokens),
                })),
          agents: readArray(workbench.agents).flatMap((agent) => {
            if (typeof agent === "string") return [{ name: agent }];
            const record = readRecord(agent);
            const name = readString(record.name);
            return name ? [{ name, description: readString(record.description) }] : [];
          }),
          memoryTokens: displayState.omProgress.observationTokens,
          // Native: the actual remembered observation text (agent.getObservationalMemoryRecord).
          observationText,
          updatedAt: new Date().toISOString(),
        }),
        // The two OM windows (messages → observe, observations → reflect). Thresholds + tokens come
        // from omProgress (refreshed natively above). The conversation-token sum backs the message
        // window when OM hasn't tracked the thread yet (pendingTokens still 0).
        memoryWindows: omMemoryWindows(
          displayState,
          allMessages.reduce((sum, message) => sum + estimateTokens(messageText(message)), 0),
        ),
      },
      contextEntries: [],
      rawMessages: [],
    },
    debug: { events: [] },
    uiPreferences: {
      activePanel: "transcript",
      sidebarVisible: true,
      inspectorVisible: true,
      timestampsVisible: false,
      reasoningVisible: true,
      toolDetailsVisible: true,
      rawIoVisible: true,
      compactToolOutput: false,
      diffWrap: "word",
    },
    uiStatus: {
      overall: {
        status: displayState.isRunning
          ? displayState.pendingApproval || displayState.pendingSuspensions.size
            ? "waiting"
            : "running"
          : "idle",
      },
      start: { status: "idle" },
      send: { status: displayState.isRunning ? "running" : "idle" },
      threads: { status: "idle" },
      loadThread: { status: "idle" },
      cancel: { status: "idle" },
      model: { status: "idle" },
      mode: { status: "idle" },
      errors: [],
    },
  };
}

function collectTools(
  messages: HarnessMessage[],
  displayState: HarnessDisplayState,
): Record<string, unknown>[] {
  const calls = new Map<string, Record<string, unknown>>();
  const ensure = (id: string, title: string, parentMessageId?: string) => {
    const existing = calls.get(id);
    if (existing) return existing;
    const next = { id, title, status: "completed", parentMessageId };
    calls.set(id, next);
    return next;
  };
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "tool_call") {
        Object.assign(ensure(part.id, part.name, message.id), {
          rawInput: part.args,
          status: "running",
          startedAt: iso(message.createdAt),
        });
      }
      if (part.type === "tool_result") {
        Object.assign(ensure(part.id, part.name, message.id), {
          rawOutput: part.result,
          status: part.isError ? "failed" : "completed",
          completedAt: iso(message.createdAt),
          ...(part.isError ? { error: stringify(part.result) } : {}),
        });
      }
    }
  }
  for (const [id, tool] of displayState.activeTools) {
    Object.assign(ensure(id, tool.name), {
      rawInput: tool.args,
      rawOutput: tool.result ?? tool.partialResult,
      status:
        tool.isError || tool.status === "error"
          ? "failed"
          : tool.status === "completed"
            ? "completed"
            : "running",
      ...(tool.isError ? { error: stringify(tool.result ?? tool.partialResult) } : {}),
    });
  }
  for (const [id, buffer] of displayState.toolInputBuffers) {
    Object.assign(ensure(id, buffer.toolName), {
      rawInput: buffer.text,
      status: "running",
    });
  }
  if (displayState.pendingApproval) {
    const pending = displayState.pendingApproval;
    Object.assign(ensure(pending.toolCallId, pending.toolName), {
      rawInput: pending.args,
      status: "pending",
    });
  }
  for (const [id, pending] of displayState.pendingSuspensions) {
    Object.assign(ensure(id, pending.toolName), {
      rawInput: pending.args,
      rawOutput: pending.suspendPayload,
      status: "pending",
    });
  }
  return [...calls.values()];
}

function workbenchMessage(
  message: HarnessMessage,
  displayState: HarnessDisplayState,
): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    status:
      displayState.currentMessage?.id === message.id && displayState.isRunning
        ? "streaming"
        : message.stopReason === "error"
          ? "error"
          : "complete",
    createdAt: iso(message.createdAt),
    updatedAt: iso(message.createdAt),
    parts: message.content.flatMap((part) => messagePart(part)),
  };
}

function messagePart(part: HarnessMessageContent): Record<string, unknown>[] {
  switch (part.type) {
    case "text":
      return [{ kind: "text", text: part.text }];
    case "thinking":
      return [{ kind: "reasoning", text: part.thinking }];
    case "tool_call":
      return [{ kind: "tool_call_ref", toolCallId: part.id, text: part.name }];
    case "tool_result":
      return [{ kind: "tool_result_ref", toolCallId: part.id, text: part.name }];
    case "system_reminder":
      return [{ kind: "status", text: part.message }];
    case "state_signal":
    case "reactive_signal":
    case "notification_summary":
    case "notification":
      return [{ kind: "status", text: part.message }];
    default:
      return [];
  }
}

function approvalRequests(
  displayState: HarnessDisplayState,
  sessionId: string,
): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [];
  if (displayState.pendingApproval) {
    const pending = displayState.pendingApproval;
    requests.push({
      requestId: `tool-approval:${pending.toolCallId}`,
      sessionId,
      status: "pending",
      toolCall: {
        id: pending.toolCallId,
        title: pending.toolName,
        status: "pending",
        rawInput: pending.args,
      },
      options: defaultApprovalOptions(),
    });
  }
  for (const [id, pending] of displayState.pendingSuspensions) {
    requests.push({
      requestId: `tool-suspended:${id}`,
      sessionId,
      status: "pending",
      toolCall: {
        id,
        title: pending.toolName,
        status: "pending",
        rawInput: pending.args,
        rawOutput: pending.suspendPayload,
      },
      options: defaultApprovalOptions(),
    });
  }
  return requests;
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

function modelInfos(models: AvailableModel[], fallback: unknown[]): Record<string, unknown>[] {
  if (models.length > 0) {
    return models.map((model) => ({
      id: model.id,
      provider: model.provider,
      displayName: model.modelName,
      disabled: !model.hasApiKey,
    }));
  }
  return fallback.map((model) => ({
    id: readString(readRecord(model).id) ?? "model",
    provider: readString(readRecord(model).provider),
    displayName: readString(readRecord(model).displayName),
  }));
}

function memoryEntries(
  displayState: HarnessDisplayState,
  workbench: Record<string, unknown>,
): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const configured = readRecord(workbench.observationalMemory);
  if (Object.keys(configured).length > 0) entries.push(configured);
  if (displayState.omProgress.status !== "idle") {
    entries.push({
      id: `om:${displayState.omProgress.cycleId ?? "active"}`,
      kind: "observation",
      status: displayState.omProgress.status === "observing" ? "loading" : "buffering",
      title: "Observational memory",
      summary: `${displayState.omProgress.pendingTokens.toLocaleString()} tokens pending`,
      raw: displayState.omProgress,
    });
  }
  return entries;
}

function systemPromptSnapshot(value: unknown): Record<string, unknown> | undefined {
  const record = readRecord(value);
  const content = readString(record.content);
  if (!content) return undefined;
  return {
    content,
    source: readString(record.source),
    updatedAt: readString(record.updatedAt),
  };
}

function mergeCurrentMessage(
  messages: HarnessMessage[],
  displayState: HarnessDisplayState,
): HarnessMessage[] {
  if (!displayState.isRunning) return messages;
  const current = displayState.currentMessage;
  if (!current) return messages;
  const index = messages.findIndex((message) => message.id === current.id);
  if (index === -1) return [...messages, current];
  return messages.map((message, position) => (position === index ? current : message));
}

function activeToolIds(displayState: HarnessDisplayState): string[] {
  return [
    ...displayState.activeTools.keys(),
    ...displayState.toolInputBuffers.keys(),
    ...(displayState.pendingApproval ? [displayState.pendingApproval.toolCallId] : []),
    ...displayState.pendingSuspensions.keys(),
  ];
}

async function listThreadSummaries(web: WebRuntime): Promise<Record<string, unknown>[]> {
  const threads = await web.session.thread.list();
  const cwd = web.runtime.workspace?.cwd;
  // mastra's thread.list() returns threads across ALL resourceIds (every cwd pea ran in), but
  // switch/getThreadById is resourceId-scoped — opening a foreign-cwd thread throws
  // "Thread not found" (which the SPA swallows → blank render). Scope the list to the current
  // workspace's resourceId so the palette only offers threads that can actually be opened, and
  // so boot picks an openable most-recent thread. The current thread carries the session's
  // resourceId; fall back to the full list if we somehow can't resolve it.
  const currentThreadId = web.session.thread.getId();
  const currentResourceId = threads.find((thread) => thread.id === currentThreadId)?.resourceId;
  const scoped = currentResourceId
    ? threads.filter((thread) => thread.resourceId === currentResourceId)
    : threads;
  return scoped.map((thread) => ({
    ...threadInfo(thread, cwd),
    id: thread.id,
    messageCount: 0,
    persisted: true,
    promptActive: thread.id === currentThreadId && web.session.displayState.get().isRunning,
  }));
}

function threadInfo(thread: HarnessThread, cwd?: string): Record<string, unknown> {
  return {
    threadId: thread.id,
    id: thread.id,
    title: threadTitle(thread),
    cwd,
    updatedAt: iso(thread.updatedAt),
  };
}

async function switchThread(session: RuntimeWorkbenchSession, threadId: string): Promise<void> {
  if (session.thread.getId() === threadId) return;
  await session.thread.switch({ threadId });
}

/**
 * Fork = branch a thread at the clicked turn (not a whole-thread copy). We clone through
 * `@mastra/memory` rather than raw storage so observational memory is remapped onto the
 * fork; `endDate` keeps every message up to and including the clicked turn. Falls back to a
 * whole-thread clone when the runtime doesn't expose memory or the message can't be located.
 */
async function forkWorkbenchThread(
  web: WebRuntime,
  sourceThreadId: string,
  messageId: string | undefined,
): Promise<{ id: string }> {
  const title = nextForkTitle(await web.session.thread.list(), sourceThreadId);
  const memory = web.runtime.memory;
  if (!memory) return web.session.thread.clone({ sourceThreadId, title });
  // ponytail: a same-millisecond sibling of the clicked turn would sneak in; real user
  // turns are seconds apart. Switch to messageFilter.messageIds (the prefix) if that bites.
  const endDate = messageId
    ? await forkPointDate(web.session, sourceThreadId, messageId)
    : undefined;
  const { thread } = await memory.cloneThread({
    sourceThreadId,
    title,
    ...(endDate ? { options: { messageFilter: { endDate } } } : {}),
  });
  await switchThread(web.session, thread.id);
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

function readAttachments(
  value: unknown[] | undefined,
): Array<{ data: string; mediaType: string; filename?: string }> | undefined {
  const files = (value ?? []).flatMap((entry) => {
    const record = readRecord(entry);
    const data = readString(record.data) ?? readString(record.text);
    if (!data) return [];
    return [
      {
        data,
        mediaType: readString(record.mimeType) ?? "text/plain",
        ...(readString(record.name) ? { filename: readString(record.name) } : {}),
      },
    ];
  });
  return files.length > 0 ? files : undefined;
}

function currentThreadTitle(
  threads: HarnessThread[],
  threadId: string | null | undefined,
): string | undefined {
  const thread = threads.find((thread) => thread.id === threadId);
  return thread ? threadTitle(thread) : undefined;
}

function threadTitle(thread: HarnessThread): string {
  const title = thread.title?.trim();
  return title ? title : shortId(thread.id);
}

function messageText(message: HarnessMessage): string {
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "thinking") return part.thinking;
      if ("message" in part && typeof part.message === "string") return part.message;
      return "";
    })
    .join("\n");
}

function defaultApprovalOptions(): Record<string, string>[] {
  return [
    { optionId: "allow_once", name: "Approve", kind: "allow_once" },
    { optionId: "reject_once", name: "Deny", kind: "reject_once" },
  ];
}

async function handleStaticRequest(
  staticDir: string,
  workbenchUrl: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(staticDir, `.${pathname}`);
  const root = path.resolve(staticDir);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let body = await fs.readFile(filePath);
    if (pathname.endsWith("index.html")) {
      const text = body
        .toString("utf8")
        .replace(
          "</head>",
          `<script>window.__PE_WORKBENCH_URL__=${JSON.stringify(workbenchUrl)}</script></head>`,
        );
      body = Buffer.from(text);
    }
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

function writeSseHeaders(response: ServerResponse): void {
  setCors(response);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function writeSse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  setCors(response);
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function setCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, authorization, x-runtime-workbench-token, x-runtime-local-token, x-pea-local-token",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  return readRecord(parsed);
}

function listen(
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function addressPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (address && typeof address === "object") return address.port;
  throw new Error("Server did not expose a TCP address.");
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function readAccessLevel(value: unknown): "read-only" | "ask" | "trusted" {
  return value === "read-only" || value === "ask" || value === "trusted" ? value : "trusted";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * The two observational-memory windows for the workbench, read from the live `omProgress`.
 * messages → observe at `observationThreshold`; observations → reflect (compress in place)
 * at `reflectionThreshold`, down to `reflectionFloor`. All config-derived, never hardcoded.
 */
function omMemoryWindows(
  displayState: HarnessDisplayState,
  conversationTokens: number,
): Record<string, unknown> | undefined {
  const om = displayState.omProgress;
  if (!om) return undefined;
  const floor = om.buffered?.reflection?.observationTokens ?? 0;
  return {
    // OM's tracked message buffer once it's seen the thread; until then the live conversation
    // size, so the window never reads 0 against a non-empty thread.
    messageTokens: om.pendingTokens || conversationTokens || 0,
    observationThreshold: om.threshold ?? 0,
    observationTokens: om.observationTokens ?? 0,
    reflectionThreshold: om.reflectionThreshold ?? 0,
    ...(floor > 0 ? { reflectionFloor: floor } : {}),
    observing: Boolean(displayState.bufferingMessages) || om.status === "observing",
    reflecting: Boolean(displayState.bufferingObservations),
  };
}

/**
 * Native OM refresh: reconstruct `omProgress` (real message/observation tokens + config thresholds)
 * from the stored OM record so the memory windows populate on thread load rather than only after a
 * live run. Guarded — no-op if the harness lacks the accessor or the thread has no OM record.
 */
async function loadOMProgressSafe(web: WebRuntime): Promise<void> {
  const harness = readRecord(web.runtime.harness);
  const load = harness.loadOMProgress;
  if (typeof load !== "function") return;
  try {
    await load.call(harness, web.session);
  } catch {
    // best-effort; displayState keeps its current omProgress
  }
}

/**
 * Native read of the actual remembered observation text via `harness.getObservationalMemoryRecord`
 * (public on both 1.42 and 1.46 — the older takes no args, the newer takes the session; the extra
 * arg is ignored). Returns the active observations so the Memory card shows what the agent
 * remembers, not just a token count. Guarded; undefined when there's no record yet.
 */
async function loadObservationTextSafe(web: WebRuntime): Promise<string | undefined> {
  const harness = readRecord(web.runtime.harness);
  const getRecord = harness.getObservationalMemoryRecord;
  if (typeof getRecord !== "function") return undefined;
  try {
    const record = await getRecord.call(harness, web.session);
    const text = readString(readRecord(record).activeObservations);
    return text && text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Map the captured provider tool list (workbench.toolList snapshot) into breakdown tools. */
function contextBreakdownTools(toolList: unknown): ContextBreakdownTool[] {
  return readArray(readRecord(toolList).tools).flatMap((tool) => {
    const record = readRecord(tool);
    const name = readString(record.name);
    return name
      ? [
          {
            name,
            type: readString(record.type),
            id: readString(record.id),
            description: readString(record.description),
            approxTokens: readNumber(record.approxTokens),
          },
        ]
      : [];
  });
}

/**
 * Native-first breakdown inputs: read the live mastra agent's resolved tool set (with input/
 * output schemas) and resolved system prompt directly from the agent — no per-runtime capture
 * shim. Reachable identically for pea and peco because the agent and its accessors are native
 * mastra. Cached per mode. ponytail: per-mode cache, no TTL — a slightly stale system prompt
 * between mode switches is fine for a dev inspector; widen invalidation only if it bites.
 */
async function resolveNativeBreakdownMeta(
  web: WebRuntime,
): Promise<NativeBreakdownMeta | undefined> {
  const modeId = readMode(web.session);
  if (!web.nativeMeta || web.nativeMeta.modeId !== modeId) {
    web.nativeMeta = { modeId, promise: computeNativeBreakdownMeta(web) };
  }
  return web.nativeMeta.promise;
}

async function computeNativeBreakdownMeta(
  web: WebRuntime,
): Promise<NativeBreakdownMeta | undefined> {
  const agent = currentAgent(web);
  if (!agent) return undefined;
  try {
    // Hand the accessors the harness's own request context (model selection, workspace, state) —
    // the same context a real run builds. Without it mastracode's model resolver throws
    // ("No model selected"), which would abort getToolsForExecution. Timeout-guarded so a slow
    // accessor can never stall the SSE projection (it just falls back to the metadata path).
    const requestContext = await buildAgentRequestContext(web);
    const arg = requestContext ? { requestContext } : {};
    const resolved = await withTimeout(
      Promise.all([
        Promise.resolve(callAgent(agent, "getToolsForExecution", arg)),
        Promise.resolve(callAgent(agent, "getInstructions", arg)),
        // Native skill list (name + description). Skills are on-demand corpus, so description is
        // the card body — never dumped as in-context bytes. Returns [] when none configured.
        Promise.resolve(callAgent(agent, "listSkills", arg)).catch(() => []),
      ]),
      4000,
    );
    if (!resolved) return undefined;
    const [toolsRecord, instructions, skillList] = resolved;
    const tools = mapCoreTools(toolsRecord);
    const systemPromptText = instructionsToText(instructions);
    const skills = mapSkills(skillList);
    if (tools.length === 0 && systemPromptText === undefined && skills.length === 0) {
      return undefined;
    }
    return { tools, systemPromptText, skills };
  } catch {
    return undefined;
  }
}

/** Live agent for the current session/mode: native getCurrentAgent, else the mode's static agent. */
function currentAgent(web: WebRuntime): Record<string, unknown> | undefined {
  const harness = readRecord(web.runtime.harness);
  const getCurrent = harness.getCurrentAgent;
  if (typeof getCurrent === "function") {
    try {
      const agent = getCurrent.call(harness, web.session);
      if (isRecord(agent)) return agent;
    } catch {
      // fall through to the static mode agent (pea's harness keeps getCurrentAgent private)
    }
  }
  const modeId = readMode(web.session);
  const modes = typeof harness.listModes === "function" ? harness.listModes.call(harness) : [];
  const list = Array.isArray(modes) ? modes : [];
  const mode =
    list.find((entry) => readRecord(entry).id === modeId) ??
    list.find((entry) => readRecord(entry).default === true) ??
    list[0];
  const agent = readRecord(mode).agent;
  return isRecord(agent) ? agent : undefined;
}

/**
 * The harness's own request context for the live session — carries the selected model, workspace,
 * and state that the agent accessors need to resolve. `buildRequestContext` is the native builder
 * a real run uses; it's typed private but is the only seam that yields a correct context, so we
 * reach it defensively (typeof-guarded, try/catch). Returns undefined if unavailable — the caller
 * then passes a bare context, which is fine for runtimes whose model resolver has a fallback (pea).
 */
async function buildAgentRequestContext(web: WebRuntime): Promise<unknown> {
  const harness = readRecord(web.runtime.harness);
  const build = harness.buildRequestContext;
  if (typeof build !== "function") return undefined;
  try {
    return await build.call(harness, web.session);
  } catch {
    return undefined;
  }
}

function callAgent(agent: Record<string, unknown>, method: string, arg: unknown): unknown {
  const fn = agent[method];
  return typeof fn === "function" ? fn.call(agent, arg) : undefined;
}

function readMode(session: RuntimeWorkbenchSession): string | undefined {
  const mode = readRecord((session as unknown as Record<string, unknown>).mode);
  const get = mode.get;
  return typeof get === "function" ? readString(get.call(mode)) : undefined;
}

/** Map a mastra CoreTool record (name → tool) into breakdown tools, keeping JSON schemas. */
function mapCoreTools(record: unknown): ContextBreakdownTool[] {
  if (!isRecord(record)) return [];
  return Object.entries(record).flatMap(([name, tool]) => {
    const entry = readRecord(tool);
    const inputSchema = extractJsonSchema(entry.inputSchema ?? entry.parameters);
    const outputSchema = extractJsonSchema(entry.outputSchema);
    return [
      {
        name,
        type: readString(entry.type),
        id: readString(entry.id),
        description: readString(entry.description),
        inputSchema,
        outputSchema,
        approxTokens: approxToolTokens(name, entry.description, inputSchema),
      },
    ];
  });
}

/** Map native SkillMetadata[] (from agent.listSkills) into breakdown skills. */
function mapSkills(list: unknown): ContextBreakdownSkill[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const record = readRecord(entry);
    const name = readString(record.name);
    if (!name) return [];
    const description = readString(record.description);
    return [{ name, description, body: description }];
  });
}

/** AI-SDK Schema carries `.jsonSchema`; a raw JSON schema is used as-is. Zod-only schemas yield none. */
function extractJsonSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return undefined;
  if (isRecord(schema.jsonSchema)) return schema.jsonSchema;
  if ("type" in schema || "properties" in schema || "$schema" in schema || "anyOf" in schema) {
    return schema;
  }
  return undefined;
}

function approxToolTokens(name: string, description: unknown, inputSchema: unknown): number {
  const desc = typeof description === "string" ? description : "";
  let schemaLen = 0;
  try {
    schemaLen = inputSchema ? JSON.stringify(inputSchema).length : 0;
  } catch {
    schemaLen = 0;
  }
  return Math.ceil((name.length + desc.length + schemaLen) / 4);
}

/** Flatten a mastra `AgentInstructions` (string | SystemMessage | parts) into prompt text. */
function instructionsToText(instructions: unknown): string | undefined {
  if (instructions === undefined || instructions === null) return undefined;
  if (typeof instructions === "string") return instructions.trim() || undefined;
  if (Array.isArray(instructions)) {
    const text = instructions
      .map((part) => systemPartText(part))
      .filter(Boolean)
      .join("\n");
    return text.trim() || undefined;
  }
  if (isRecord(instructions)) return instructionsToText(instructions.content ?? instructions.text);
  return undefined;
}

function systemPartText(part: unknown): string {
  if (typeof part === "string") return part;
  const record = readRecord(part);
  return readString(record.text) ?? readString(record.content) ?? "";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function iso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeIdleConnections?.();
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 1_000),
  );
  await Promise.race([closed, timeout]);
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  let closing = false;
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void close().finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
