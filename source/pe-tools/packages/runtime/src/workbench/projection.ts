import type {
  AvailableModel,
  HarnessDisplayState,
  HarnessMessage,
  HarnessMessageContent,
} from "@mastra/core/harness";
import {
  buildContextBreakdown,
  estimateTokens,
  type ContextBreakdownSkill,
  type ContextBreakdownTool,
} from "../context-breakdown.ts";
import {
  currentThreadTitle,
  isRecord,
  iso,
  readAccessLevel,
  readArray,
  readNumber,
  readRecord,
  readString,
  stringify,
  threadInfo,
} from "./shared.ts";
import type {
  NativeBreakdownMeta,
  RuntimeWorkbenchSession,
  WorkbenchContext,
  WorkbenchStateOptions,
} from "./types.ts";

export async function projectWorkbenchState(
  context: WorkbenchContext,
  threadIdInput?: string,
  options?: WorkbenchStateOptions,
): Promise<Record<string, unknown>> {
  const session = context.session;
  const threadId = threadIdInput ?? session.thread.getId();
  const [threads, availableModels] = await Promise.all([
    session.thread.list(),
    context.runtime.harness.listAvailableModels().catch((): AvailableModel[] => []),
  ]);
  const messages = threadId ? await session.thread.listMessages({ threadId }) : [];
  // Native OM refresh: reconstruct omProgress (real message/observation tokens + config thresholds)
  // from the stored OM record so the memory windows populate on thread load, not only after a run.
  // CRITICAL: loadOMProgress EMITS an om_status/display_state_changed event. Running it inside
  // the streamed projection makes every frame re-trigger the SSE pump into an unbounded loop.
  // OM refresh is a load-time concern: GET state/hydrate paths do it; per-frame streams must not.
  if (!options?.skipOMRefresh) await loadOMProgressSafe(context);
  const observationText = options?.skipOMRefresh
    ? undefined
    : await loadObservationTextSafe(context);
  const displayState = session.displayState.get();
  const allMessages = mergeCurrentMessage(messages, displayState);
  const workbench = readRecord(context.runtime.metadata?.workbench);
  // Native-first: read tools and the resolved system prompt from the Mastra agent. Fall back to
  // pea's metadata.workbench shims when accessors are unavailable.
  const native = await resolveNativeBreakdownMeta(context);
  const harnessState = readRecord(session.state.get());
  const accessLevel = readAccessLevel(
    harnessState.accessLevel ?? (harnessState.yolo === true ? "trusted" : "ask"),
  );
  const tools = collectWorkbenchTools(allMessages, displayState);

  return {
    agent: {
      info: {
        name: context.label,
        title: context.title,
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
        cwd: readString(context.runtime.workspace?.cwd) ?? process.cwd(),
        title: currentThreadTitle(threads, threadId),
        updatedAt: new Date().toISOString(),
      },
    },
    threads: {
      items: threads.map((thread) => threadInfo(thread, context.runtime.workspace?.cwd)),
      activeThreadId: threadId,
      selectedThreadId: threadId,
      status: "loaded",
    },
    transcript: {
      messages: allMessages.map((message) => workbenchMessage(message, displayState)),
      status: "loaded",
    },
    tools: {
      // Stream refs only. Heavy rawInput/rawOutput are fetched on demand per tool id via
      // GET /workbench/tool; sending them in every frame made large threads huge.
      calls: tools.map(toToolRef),
      activeToolCallIds: activeToolIds(displayState),
      recentToolCallIds: tools
        .slice(-20)
        .map((tool) => readString(readRecord(tool).id))
        .filter(Boolean),
      rawIoAvailable: true,
    },
    approvals: { requests: approvalRequests(displayState, context.label) },
    plans: {
      entries: displayState.tasks.map((task) => ({
        id: task.id,
        content: task.content,
        status: task.status,
      })),
    },
    // DEFERRED (frame size): `availableModels` is the dominant payload now that raw tool I/O is
    // stripped. Measured on a 353-msg/460-tool thread (2026-06-26): one frame ~1.1MB, of which
    //   models 519KB (4,550 entries) · transcript 217KB · inspector 182KB · tools(refs) 123KB.
    // The model catalog is STATIC for the session yet re-serialized on every stream frame, and
    // `listAvailableModels()` (line ~41) is re-resolved per projection. Can't simply drop it from
    // stream frames: the web client does a full-state REPLACE (setState(next)), so an omitted
    // section blanks that UI mid-run. Real fix = Layer 3 (client shallow-merges partial frames →
    // server omits unchanged static sections). Cheap interim = memoize listAvailableModels. Both
    // deferred; the OOM/loop crisis is already resolved so ~1.1MB×~9 frames/run on localhost is fine.
    models: {
      currentModelId: session.model.get() || readString(harnessState.currentModelId),
      availableModels: modelInfos(availableModels, readArray(workbench.availableModels)),
      recentModelIds: [],
    },
    modes: {
      currentModeId: session.mode.get(),
      availableModes: context.runtime.harness
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
          ? { content: native.systemPromptText, source: "resolved: agent.getInstructions" }
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
        // The two OM windows (messages -> observe, observations -> reflect). Thresholds + tokens
        // come from omProgress; the conversation-token sum backs the message window before OM has
        // tracked the thread.
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

export function collectWorkbenchTools(
  messages: HarnessMessage[],
  displayState?: HarnessDisplayState,
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
  for (const [id, tool] of displayState?.activeTools ?? []) {
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
  for (const [id, buffer] of displayState?.toolInputBuffers ?? []) {
    Object.assign(ensure(id, buffer.toolName), {
      rawInput: buffer.text,
      status: "running",
    });
  }
  if (displayState?.pendingApproval) {
    const pending = displayState.pendingApproval;
    Object.assign(ensure(pending.toolCallId, pending.toolName), {
      rawInput: pending.args,
      status: "pending",
    });
  }
  for (const [id, pending] of displayState?.pendingSuspensions ?? []) {
    Object.assign(ensure(id, pending.toolName), {
      rawInput: pending.args,
      rawOutput: pending.suspendPayload,
      status: "pending",
    });
  }
  return [...calls.values()];
}

export function mergeCurrentMessage(
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

/** Drop the heavy raw I/O for the stream, keeping a small `target` label for the inline marker. */
function toToolRef(tool: Record<string, unknown>): Record<string, unknown> {
  const { rawInput, rawOutput, error, ...ref } = tool;
  void rawOutput;
  void error;
  const target = toolTargetHint(rawInput);
  return target ? { ...ref, target } : ref;
}

/** Mirror the client's marker label: a short path/file/query/command from the tool input. */
function toolTargetHint(args: unknown): string | undefined {
  if (isRecord(args)) {
    const candidate = args.path ?? args.file ?? args.query ?? args.command;
    if (typeof candidate === "string") return candidate;
  }
  if (typeof args === "string" && args.length <= 64) return args;
  return undefined;
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

function defaultApprovalOptions(): Record<string, string>[] {
  return [
    { optionId: "allow_once", name: "Approve", kind: "allow_once" },
    { optionId: "reject_once", name: "Deny", kind: "reject_once" },
  ];
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

function activeToolIds(displayState: HarnessDisplayState): string[] {
  return [
    ...displayState.activeTools.keys(),
    ...displayState.toolInputBuffers.keys(),
    ...(displayState.pendingApproval ? [displayState.pendingApproval.toolCallId] : []),
    ...displayState.pendingSuspensions.keys(),
  ];
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

/**
 * The two observational-memory windows for the workbench, read from the live `omProgress`.
 * messages -> observe at `observationThreshold`; observations -> reflect (compress in place)
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
    // OM's tracked message buffer once it has seen the thread; until then use the live
    // conversation size, so the window never reads 0 against a non-empty thread.
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
 * Native OM refresh: reconstruct `omProgress` from the stored OM record so memory windows populate
 * on thread load rather than only after a live run. Guarded; no-op if the harness lacks the
 * accessor or the thread has no OM record.
 */
async function loadOMProgressSafe(context: WorkbenchContext): Promise<void> {
  const harness = readRecord(context.runtime.harness);
  const load = harness.loadOMProgress;
  if (typeof load !== "function") return;
  try {
    await load.call(harness, context.session);
  } catch {
    // best-effort; displayState keeps its current omProgress
  }
}

/**
 * Native read of remembered observation text via `harness.getObservationalMemoryRecord`.
 * Guarded; undefined when there is no record yet.
 */
async function loadObservationTextSafe(context: WorkbenchContext): Promise<string | undefined> {
  const harness = readRecord(context.runtime.harness);
  const getRecord = harness.getObservationalMemoryRecord;
  if (typeof getRecord !== "function") return undefined;
  try {
    const record = await getRecord.call(harness, context.session);
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
 * Native-first breakdown inputs: read the live Mastra agent's resolved tool set and system prompt.
 * Cached per mode. ponytail: no TTL; a slightly stale inspector between mode switches is fine.
 */
async function resolveNativeBreakdownMeta(
  context: WorkbenchContext,
): Promise<NativeBreakdownMeta | undefined> {
  const modeId = readMode(context.session);
  if (!context.nativeMeta || context.nativeMeta.modeId !== modeId) {
    context.nativeMeta = { modeId, promise: computeNativeBreakdownMeta(context) };
  }
  return context.nativeMeta.promise;
}

async function computeNativeBreakdownMeta(
  context: WorkbenchContext,
): Promise<NativeBreakdownMeta | undefined> {
  const agent = currentAgent(context);
  if (!agent) return undefined;
  try {
    // Hand the accessors the harness's own request context; without it mastracode's model
    // resolver can throw. Timeout-guarded so slow accessors fall back to metadata.
    const requestContext = await buildAgentRequestContext(context);
    const arg = requestContext ? { requestContext } : {};
    const resolved = await withTimeout(
      Promise.all([
        Promise.resolve(callAgent(agent, "getToolsForExecution", arg)),
        Promise.resolve(callAgent(agent, "getInstructions", arg)),
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
function currentAgent(context: WorkbenchContext): Record<string, unknown> | undefined {
  const harness = readRecord(context.runtime.harness);
  const getCurrent = harness.getCurrentAgent;
  if (typeof getCurrent === "function") {
    try {
      const agent = getCurrent.call(harness, context.session);
      if (isRecord(agent)) return agent;
    } catch {
      // fall through to the static mode agent
    }
  }
  const modeId = readMode(context.session);
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
 * The harness's own request context for the live session. `buildRequestContext` is typed private
 * but is the only seam that yields the same context as a real run, so reach it defensively.
 */
async function buildAgentRequestContext(context: WorkbenchContext): Promise<unknown> {
  const harness = readRecord(context.runtime.harness);
  const build = harness.buildRequestContext;
  if (typeof build !== "function") return undefined;
  try {
    return await build.call(harness, context.session);
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

/** Map a Mastra CoreTool record (name -> tool) into breakdown tools, keeping JSON schemas. */
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

/** AI-SDK Schema carries `.jsonSchema`; a raw JSON schema is used as-is. */
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

/** Flatten Mastra `AgentInstructions` (string | SystemMessage | parts) into prompt text. */
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
