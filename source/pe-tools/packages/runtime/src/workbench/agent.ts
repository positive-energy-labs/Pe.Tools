import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  WorkbenchAccessLevel,
  WorkbenchAccessLevelInfo,
  WorkbenchEvent,
  WorkbenchJsonObject,
  WorkbenchModelInfo,
  WorkbenchThreadInfo,
} from "@pe/agent-contracts";
import { createRuntimeLocalTransportAuth, type RuntimeLocalTransportAuth } from "../transport.js";
import { logoutRuntimeAuth, type RuntimeAuthProfile } from "../auth/types.ts";
import type {
  RuntimeAccessLevel,
  RuntimeDescriptor,
  RuntimeFactory,
  RuntimeHandle,
  RuntimeHandleHarness,
  RuntimeHandleServices,
  RuntimeThreadMessage,
} from "../runtime.ts";
import type { RuntimeResumeDecision } from "../interrupts.ts";
import type { RuntimeResource } from "../resources.ts";
import { createRuntimePrompt, type RuntimePromptPart } from "../prompts.ts";
import {
  RuntimeProtocolSessions,
  type RuntimeProtocolSession,
  type RuntimeProtocolSessionInfo,
} from "../session/protocol-sessions.ts";
import type { RuntimeThreadIndex } from "../storage/thread-index.ts";
import type { RuntimeEvent } from "../events.ts";
import {
  approvalRequestId,
  isApprovalOptionAllowed,
  RuntimeToWorkbenchEvents,
  runtimeMessagesToWorkbenchEvents,
} from "./events-map-runtime-workbench.ts";
import {
  buildContextBreakdown,
  estimateTokens,
  type ContextBreakdownMessage,
  type ContextBreakdownSkill,
  type ContextBreakdownTool,
} from "../context-breakdown.ts";
import type { WorkbenchSystemPromptSnapshot } from "@pe/agent-contracts";
import { z } from "zod";

export interface RuntimeWorkbenchRuntimeOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  factory: RuntimeFactory<TState, TServices, RuntimeHandleHarness<TState>>;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  override?: RuntimeHandle<TState, TServices, RuntimeHandleHarness<TState>>;
}

export interface RuntimeWorkbenchSessionOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  defaultCwd?: string;
  manager?: RuntimeProtocolSessions<TState, TServices>;
  threadIndex?: RuntimeThreadIndex;
}

export interface RuntimeWorkbenchTransportOptions {
  port?: number;
  token?: string;
}

export interface RuntimeWorkbenchAgentOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  runtime?: RuntimeWorkbenchRuntimeOptions<TState, TServices>;
  sessions?: RuntimeWorkbenchSessionOptions<TState, TServices>;
  transport?: RuntimeWorkbenchTransportOptions;
}

export interface RuntimeWorkbenchServerInfo {
  workbenchUrl: string;
  threadsUrl: string;
  logoutUrl: string;
  token: string;
  port: number;
}

const defaultPort = 43112;
const loopbackHost = "127.0.0.1";
// A thread's run is "claimed" by the last client that ran it; a different client is blocked
// while that run is active or for this long after it, so two browser tabs can't diverge one
// thread. Cross-tab analogue of the cross-process file lock (which still guards other processes).
const runClaimTtlMs = 30_000;

const ACCESS_LEVELS: WorkbenchAccessLevelInfo[] = [
  { id: "read-only", name: "Read only", description: "No edits or commands; read tools only." },
  { id: "ask", name: "Ask", description: "Pause for approval before each tool runs." },
  { id: "trusted", name: "Trusted", description: "Run tools without asking." },
];

export class RuntimeWorkbenchAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  private readonly runtimeSessions: RuntimeProtocolSessions<TState, TServices>;
  /** `${threadId}:${requestId}` -> resolver for an in-flight tool-approval gate (mirrors ACP). */
  private readonly approvalResolvers = new Map<string, (decision: RuntimeResumeDecision) => void>();
  /** threadId -> the client currently allowed to run it (cross-tab guard). */
  private readonly runClaims = new Map<string, { clientId: string; at: number; active: boolean }>();

  constructor(private readonly options: RuntimeWorkbenchAgentOptions<TState, TServices>) {
    this.runtimeSessions =
      options.sessions?.manager ??
      new RuntimeProtocolSessions({
        factory: runtimeFactory(options),
        defaultCwd: defaultWorkbenchCwd(options),
        threadIndex: options.sessions?.threadIndex,
      });
  }

  async runWorkbench(body: WorkbenchRunBody, emit: (event: WorkbenchEvent) => void): Promise<void> {
    const clientId = body.clientId ?? "";
    const blockedReason = this.claimRun(body.threadId, clientId);
    if (blockedReason) {
      emit({ type: "error", message: blockedReason });
      emit({ type: "run_status_changed", status: "error", timestamp: new Date().toISOString() });
      return;
    }
    try {
      await this.runWorkbenchInner(body, emit);
    } finally {
      this.endRun(body.threadId, clientId);
    }
  }

  /** Reserve this thread's run for `clientId`; returns a reason string if another client holds it. */
  private claimRun(threadId: string, clientId: string): string | undefined {
    const now = Date.now();
    const existing = this.runClaims.get(threadId);
    if (
      existing &&
      existing.clientId !== clientId &&
      (existing.active || now - existing.at < runClaimTtlMs)
    ) {
      return "This thread is open in another tab or window. Send from there, or take over it here.";
    }
    this.runClaims.set(threadId, { clientId, at: now, active: true });
    return undefined;
  }

  /** Mark the run finished; the claim lingers (idle) for `runClaimTtlMs` then frees. */
  private endRun(threadId: string, clientId: string): void {
    const existing = this.runClaims.get(threadId);
    if (existing && existing.clientId === clientId) {
      this.runClaims.set(threadId, { clientId, at: Date.now(), active: false });
    }
  }

  private async runWorkbenchInner(
    body: WorkbenchRunBody,
    emit: (event: WorkbenchEvent) => void,
  ): Promise<void> {
    const session = await this.runtimeSessions.getOrCreateThreadSession({
      // `protocol: "ag-ui"` is the durable libsql storage discriminator for these
      // threads — NOT a live protocol. It stays for data compatibility with existing
      // threads even though the ag-ui wire path is gone.
      protocol: "ag-ui",
      externalThreadId: body.threadId,
      cwd: body.cwd ?? defaultWorkbenchCwd(this.options),
      additionalDirectories: body.additionalDirectories ?? [],
      title: `Workbench ${body.threadId}`,
    });

    emit(this.agentInitializedEvent(session));

    const timestamp = new Date().toISOString();
    // `session_updated` (merge) NOT `session_started` (which wipes
    // transcript/tools/plans) — every prompt opens a fresh SSE run on the same
    // thread, so a wipe here would erase the prior turns in a multi-message thread.
    emit({
      type: "session_updated",
      session: {
        sessionId: session.id,
        cwd: session.cwd,
        additionalDirectories: session.additionalDirectories ?? [],
        title: session.title,
        updatedAt: timestamp,
        metadata: { protocol: "workbench" },
      },
    });

    // Echo the user's prompt into the transcript immediately. The RuntimeEvent
    // stream starts at the assistant turn (the runtime persists the user message
    // but does not re-emit it live), so without this the user's own message would
    // not appear until a reload re-hydrated it.
    emit({
      type: "message_updated",
      message: {
        id: `user:${randomUUID()}`,
        role: "user",
        parts: [{ kind: "text", text: body.text }],
        status: "complete",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    const translator = new RuntimeToWorkbenchEvents({
      sessionId: session.id,
      threadId: body.threadId,
    });
    const unsubscribe = this.runtimeSessions.subscribe(session.id, (event) => {
      for (const workbenchEvent of translator.translate(event)) emit(workbenchEvent);
      // Mirror the ACP permission flow: a tool needing approval gates the run on a client
      // decision delivered out-of-band via the /workbench/approve route.
      if (event.type === "tool_started") this.gateToolApproval(session.id, body.threadId, event);
    });

    try {
      emit({ type: "run_status_changed", status: "running", timestamp });
      await this.runtimeSessions.sendPrompt(session.id, workbenchPrompt(body));
      // The system-prompt capture + final-tool-list sink populate the live handle metadata
      // during the run, so the breakdown is ready once sendPrompt resolves.
      const inspector = await contextInspectorUpdate(session);
      if (inspector) emit(inspector);
      for (const controls of this.controlsEvents(session.id)) emit(controls);
      emit({ type: "run_status_changed", status: "idle", timestamp: new Date().toISOString() });
    } catch (error) {
      emit({ type: "error", message: errorMessage(error) });
      emit({ type: "run_status_changed", status: "error", timestamp: new Date().toISOString() });
    } finally {
      unsubscribe();
      this.clearThreadApprovals(body.threadId, emit);
    }
  }

  /** Resolve a pending tool approval (from the /workbench/approve route). */
  resolveApproval(threadId: string, requestId: string, optionId?: string): boolean {
    const key = `${threadId}:${requestId}`;
    const resolve = this.approvalResolvers.get(key);
    if (!resolve) return false;
    this.approvalResolvers.delete(key);
    resolve({
      interruptId: requestId,
      status: isApprovalOptionAllowed(optionId) ? "resolved" : "cancelled",
      ...(optionId ? { payload: { optionId } } : {}),
    });
    return true;
  }

  async setModel(threadId: string, modelId: string): Promise<WorkbenchEvent[]> {
    const session = await this.ensureSession(threadId);
    const controls = await this.runtimeSessions.setModel(session.id, modelId);
    return [{ type: "model_state_updated", model: { currentModelId: controls.currentModelId } }];
  }

  async setAccessLevel(
    threadId: string,
    accessLevel: WorkbenchAccessLevel,
  ): Promise<WorkbenchEvent[]> {
    const session = await this.ensureSession(threadId);
    const controls = await this.runtimeSessions.setAccessLevel(
      session.id,
      accessLevel as RuntimeAccessLevel,
    );
    return [
      {
        type: "access_level_updated",
        access: { currentAccessLevel: controls.accessLevel, availableAccessLevels: ACCESS_LEVELS },
      },
    ];
  }

  /** Fork a thread into a fresh conversation; returns the new threadId to switch to. */
  async forkThread(threadId: string): Promise<string | undefined> {
    const source = await this.ensureSession(threadId);
    const forked = await this.runtimeSessions.forkSession(source.id, {
      cwd: source.cwd,
      additionalDirectories: source.additionalDirectories,
      title: `${source.title} (fork)`,
    });
    return forked.externalThreadId ?? forked.threadId ?? forked.id;
  }

  /** Static access-level catalog, surfaced on hydrate so the picker has options up front. */
  accessLevelCatalog(): WorkbenchEvent {
    return { type: "access_level_updated", access: { availableAccessLevels: ACCESS_LEVELS } };
  }

  private gateToolApproval(
    sessionId: string,
    threadId: string,
    event: Extract<RuntimeEvent, { type: "tool_started" }>,
  ): void {
    if (event.status !== "pending_approval" && event.status !== "suspended") return;
    const requestId = approvalRequestId(event.toolCallId, event.status === "suspended");
    const key = `${threadId}:${requestId}`;
    if (this.approvalResolvers.has(key)) return;

    let resolveDecision!: (decision: RuntimeResumeDecision) => void;
    const decision = new Promise<RuntimeResumeDecision>((resolve) => {
      resolveDecision = resolve;
    });
    this.approvalResolvers.set(key, resolveDecision);
    // Await the decision inside the session's emit queue (which sendPrompt awaits), then
    // record it so the suspended run resumes — identical to ACP's enqueuePermissionRequest.
    this.runtimeSessions.enqueue(sessionId, async () => {
      this.runtimeSessions.recordResumeDecision(sessionId, await decision);
      this.approvalResolvers.delete(key);
    });
  }

  private clearThreadApprovals(threadId: string, emit: (event: WorkbenchEvent) => void): void {
    const prefix = `${threadId}:`;
    let cleared = false;
    for (const [key, resolve] of this.approvalResolvers) {
      if (!key.startsWith(prefix)) continue;
      this.approvalResolvers.delete(key);
      resolve({ interruptId: key.slice(prefix.length), status: "cancelled" });
      cleared = true;
    }
    if (cleared) emit({ type: "approvals_cleared", reason: "run ended" });
  }

  private controlsEvents(sessionId: string): WorkbenchEvent[] {
    let session: RuntimeProtocolSession<TState, TServices>;
    try {
      session = this.runtimeSessions.getSession(sessionId);
    } catch {
      return [];
    }
    const controls = session.runtime.kernel.readControls();
    const workbench = readWorkbenchMetadata(session.runtime.metadata);
    const availableModels = readModelList(workbench?.availableModels);
    return [
      {
        type: "access_level_updated",
        access: {
          currentAccessLevel: controls.accessLevel,
          availableAccessLevels: ACCESS_LEVELS,
        },
      },
      {
        type: "model_state_updated",
        model: {
          ...(controls.currentModelId ? { currentModelId: controls.currentModelId } : {}),
          ...(availableModels.length ? { availableModels } : {}),
        },
      },
    ];
  }

  /** Agent identity + slash-command catalog (skills), surfaced on run + hydrate. */
  agentInitializedEvent(
    session: RuntimeProtocolSession<TState, TServices> | RuntimeProtocolSessionInfo | undefined,
  ): WorkbenchEvent {
    const descriptor = runtimeDescriptor(this.options);
    const metadata = session && "runtime" in session ? session.runtime.metadata : undefined;
    const commands = readCommandList(readWorkbenchMetadata(metadata)?.skills);
    return {
      type: "agent_initialized",
      agent: {
        name: descriptor.agentName,
        title: descriptor.title,
        runtime: {
          id: descriptor.id,
          name: descriptor.agentName,
          title: descriptor.title,
          description: descriptor.description,
        },
        capabilities: {
          threads: true,
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
        ...(commands.length ? { metadata: { commands } } : {}),
      },
    };
  }

  private async ensureSession(
    threadId: string,
  ): Promise<RuntimeProtocolSession<TState, TServices>> {
    return this.runtimeSessions.getOrCreateThreadSession({
      protocol: "ag-ui",
      externalThreadId: threadId,
      cwd: defaultWorkbenchCwd(this.options),
    });
  }

  async workbenchThreads(): Promise<WorkbenchThreadInfo[]> {
    const sessions = await this.sessions();
    return sessions.map((session) => ({
      threadId: session.externalThreadId ?? session.threadId ?? session.id,
      sessionId: session.id,
      resourceId: session.resourceId,
      title: session.title,
      cwd: session.cwd,
      updatedAt: session.updatedAt,
    }));
  }

  async workbenchHydrate(threadId: string): Promise<WorkbenchEvent[]> {
    const listedSession = await this.sessionForThread(threadId);
    if (!listedSession) return [];
    const messages = await readRuntimeSessionInfoMessages(this.runtimeSessions, listedSession);
    return [
      this.agentInitializedEvent(listedSession),
      this.accessLevelCatalog(),
      ...runtimeMessagesToWorkbenchEvents(messages),
      { type: "run_status_changed", status: "idle" },
    ];
  }

  async sessions(): Promise<RuntimeProtocolSessionInfo[]> {
    const startedAt = performance.now();
    const sessions = await this.runtimeSessions.listSessions({ protocol: "ag-ui" });
    logWorkbenchServerTiming("agent.sessions", startedAt, { sessions: sessions.length });
    return sessions;
  }

  async closeThread(threadId: string): Promise<boolean> {
    const listedSession = await this.sessionForThread(threadId);
    if (!listedSession) return false;
    try {
      await this.runtimeSessions.close(listedSession.id, {
        cwd: listedSession.cwd,
        protocol: "ag-ui",
      });
    } catch (error) {
      if (!isUnknownSessionError(error)) throw error;
    }
    return true;
  }

  async deleteThread(threadId: string): Promise<boolean> {
    const listedSession = await this.sessionForThread(threadId);
    if (!listedSession) return false;
    await this.runtimeSessions.delete(listedSession.id, {
      cwd: listedSession.cwd,
      protocol: "ag-ui",
    });
    return true;
  }

  async logout(): Promise<void> {
    await logoutRuntimeAuth(runtimeAuthProfile(this.options));
  }

  async close(): Promise<void> {
    await this.runtimeSessions.closeAll();
  }

  private async sessionForThread(
    threadId: string,
  ): Promise<RuntimeProtocolSessionInfo | undefined> {
    return this.runtimeSessions.resolveSessionInfo({ id: threadId, protocol: "ag-ui" });
  }
}

interface WorkbenchRunAttachment {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
}

interface WorkbenchRunBody {
  threadId: string;
  text: string;
  /** Opaque per-tab id from the web client; gates concurrent runs of one thread (see runClaims). */
  clientId?: string;
  cwd?: string;
  additionalDirectories?: string[];
  attachments?: WorkbenchRunAttachment[];
}

/** Build the runtime prompt, mapping composer attachments to input resources. */
function workbenchPrompt(body: WorkbenchRunBody) {
  const parts: RuntimePromptPart[] = [{ text: body.text }];
  for (const [index, attachment] of (body.attachments ?? []).entries()) {
    const name = attachment.name ?? `attachment-${index + 1}`;
    const resource: RuntimeResource = {
      id: `workbench:${index}:${name}`,
      kind: "input",
      protocol: "ag-ui",
      name,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.text !== undefined ? { text: attachment.text } : {}),
      ...(attachment.data !== undefined ? { data: attachment.data } : {}),
    };
    parts.push({ text: `[attachment: ${name}]`, resource });
  }
  return createRuntimePrompt(parts);
}

const defaultContextWindow = 200_000;

/**
 * Build the `inspector_updated` event that carries the context-window breakdown + system
 * prompt for a thread. Reads the live capture refs the harness exposes on the runtime
 * handle metadata (`workbench.systemPrompt`, the final-tool-list debug entries) plus the
 * thread messages, then projects them with the core `buildContextBreakdown`.
 */
async function contextInspectorUpdate<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(session: {
  id: string;
  runtime: RuntimeHandle<TState, TServices, RuntimeHandleHarness<TState>>;
}): Promise<WorkbenchEvent | undefined> {
  const workbench = readWorkbenchMetadata(session.runtime.metadata);
  if (!workbench) return undefined;

  const messages = await session.runtime.kernel.readSessionMessages(session.id).catch(() => []);
  const breakdown = buildContextBreakdown({
    contextWindow: numberOf(workbench.contextWindow) ?? defaultContextWindow,
    systemPromptText: workbench.systemPrompt?.content,
    tools: latestFinalToolList(workbench.debug),
    messages: conversationMessages(messages),
    skills: workbenchSkills(workbench.skills),
    agents: stringArray(workbench.agents),
    updatedAt: new Date().toISOString(),
  });

  return {
    type: "inspector_updated",
    inspector: {
      contextBreakdown: breakdown,
      ...(workbench.systemPrompt ? { systemPrompt: workbench.systemPrompt } : {}),
    },
  };
}

interface WorkbenchMetadataView {
  systemPrompt?: WorkbenchSystemPromptSnapshot;
  debug?: unknown;
  skills?: unknown;
  agents?: unknown;
  contextWindow?: unknown;
  availableModels?: unknown;
}

function readWorkbenchMetadata(
  metadata: Record<string, unknown> | undefined,
): WorkbenchMetadataView | undefined {
  const workbench = metadata?.workbench;
  if (!isRecord(workbench)) return undefined;
  const systemPrompt = isRecord(workbench.systemPrompt)
    ? (workbench.systemPrompt as unknown as WorkbenchSystemPromptSnapshot)
    : undefined;
  return {
    systemPrompt: typeof systemPrompt?.content === "string" ? systemPrompt : undefined,
    debug: workbench.debug,
    skills: workbench.skills,
    agents: workbench.agents,
    contextWindow: workbench.contextWindow,
    availableModels: workbench.availableModels,
  };
}

/** Parse published model catalog entries from `metadata.workbench.availableModels`. */
function readModelList(value: unknown): WorkbenchModelInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    return [
      {
        id: entry.id,
        ...(typeof entry.displayName === "string" ? { displayName: entry.displayName } : {}),
        ...(typeof entry.provider === "string" ? { provider: entry.provider } : {}),
      },
    ];
  });
}

/** Parse the skill catalog into `{ name, description }` command entries for the slash menu. */
function readCommandList(value: unknown): WorkbenchJsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return [];
    return [
      {
        name: entry.name,
        ...(typeof entry.description === "string" ? { description: entry.description } : {}),
      } satisfies WorkbenchJsonObject,
    ];
  });
}

function latestFinalToolList(debug: unknown): ContextBreakdownTool[] {
  if (!Array.isArray(debug)) return [];
  for (let index = debug.length - 1; index >= 0; index--) {
    const entry = debug[index];
    if (!isRecord(entry)) continue;
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    if (payload?.event !== "pe.runtime.final_model_tool_list") continue;
    if (!Array.isArray(payload.tools)) return [];
    return payload.tools.flatMap((tool) => {
      if (!isRecord(tool) || typeof tool.name !== "string") return [];
      return [{ name: tool.name, approxTokens: numberOf(tool.approxTokens) }];
    });
  }
  return [];
}

function conversationMessages(messages: RuntimeThreadMessage[]): ContextBreakdownMessage[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, text: messageTokensText(message) }));
}

function messageTokensText(message: RuntimeThreadMessage): string {
  if (message.text) return message.text;
  return (message.parts ?? [])
    .map((part) => {
      if (part.type === "text" || part.type === "thinking") return part.text ?? "";
      if (part.type === "tool-call") return JSON.stringify(part.args ?? {});
      if (part.type === "tool-result") return JSON.stringify(part.result ?? {});
      return "";
    })
    .join("");
}

function workbenchSkills(value: unknown): ContextBreakdownSkill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((skill) => {
    if (!isRecord(skill) || typeof skill.name !== "string") return [];
    const approxTokens =
      numberOf(skill.approxTokens) ??
      (typeof skill.content === "string" ? estimateTokens(skill.content) : undefined);
    return [{ name: skill.name, approxTokens }];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const workbenchAttachmentSchema = z.object({
  name: z.string().optional(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  data: z.string().optional(),
});

const workbenchRunBodySchema = z.object({
  threadId: z.string(),
  text: z.string(),
  clientId: z.string().optional(),
  cwd: z.string().optional(),
  additionalDirectories: z.array(z.string()).optional(),
  attachments: z.array(workbenchAttachmentSchema).optional(),
});

function readWorkbenchRunBody(value: unknown): WorkbenchRunBody {
  return workbenchRunBodySchema.parse(value);
}

const workbenchApproveBodySchema = z.object({
  threadId: z.string(),
  requestId: z.string(),
  optionId: z.string().optional(),
});

const workbenchModelBodySchema = z.object({ threadId: z.string(), modelId: z.string() });
const workbenchAccessBodySchema = z.object({
  threadId: z.string(),
  accessLevel: z.enum(["read-only", "ask", "trusted"]),
});
const workbenchForkBodySchema = z.object({ threadId: z.string() });

function workbenchTransport<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeWorkbenchAgentOptions<TState, TServices>): RuntimeWorkbenchTransportOptions {
  return options.transport ?? {};
}

export class RuntimeWorkbenchHttpAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  private readonly auth: RuntimeLocalTransportAuth;
  private server: ReturnType<typeof createServer> | null = null;
  private agent: RuntimeWorkbenchAgent<TState, TServices>;

  constructor(private readonly options: RuntimeWorkbenchAgentOptions<TState, TServices>) {
    this.auth = createRuntimeLocalTransportAuth({
      token: workbenchTransport(options).token,
      headerNames: [
        "x-runtime-local-token",
        "x-runtime-workbench-token",
        "x-pea-local-token",
        "x-pea-workbench-token",
      ],
    });
    this.agent = new RuntimeWorkbenchAgent(options);
  }

  async start(): Promise<RuntimeWorkbenchServerInfo> {
    const port = workbenchTransport(this.options).port ?? defaultPort;
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => writeError(response, error));
    });
    await new Promise<void>((resolve) => this.server!.listen(port, loopbackHost, resolve));
    const address = this.server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    return this.startInfo(actualPort);
  }

  async close(): Promise<void> {
    await this.agent.close();
    const server = this.server;
    this.server = null;
    if (server) await closeHttpServer(server);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${loopbackHost}`);
    const startedAt = performance.now();
    let timingThreadId: string | undefined;
    addCommonHeaders(response);
    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }

      if (!this.auth.isAuthorized(request, url)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      if (url.pathname === "/workbench/threads") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ threads: await this.agent.workbenchThreads() }));
        return;
      }

      if (url.pathname === "/workbench/sessions") {
        const sessions = await this.agent.sessions();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ sessions }));
        return;
      }

      if (url.pathname === "/workbench/hydrate") {
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "threadId is required" }));
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ events: await this.agent.workbenchHydrate(threadId) }));
        return;
      }

      const threadCloseMatch = /^\/workbench\/threads\/([^/]+)\/close$/.exec(url.pathname);
      if (threadCloseMatch && request.method === "POST") {
        const threadId = decodeURIComponent(threadCloseMatch[1]!);
        if (!(await this.agent.closeThread(threadId))) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Thread not found" }));
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      const threadDeleteMatch = /^\/workbench\/threads\/([^/]+)$/.exec(url.pathname);
      if (threadDeleteMatch && request.method === "DELETE") {
        const threadId = decodeURIComponent(threadDeleteMatch[1]!);
        if (!(await this.agent.deleteThread(threadId))) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Thread not found" }));
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/workbench/logout" && request.method === "POST") {
        await this.agent.logout();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/workbench/approve" && request.method === "POST") {
        const body = workbenchApproveBodySchema.parse(await readJsonBody(request));
        const resolved = this.agent.resolveApproval(body.threadId, body.requestId, body.optionId);
        response.writeHead(resolved ? 200 : 404, { "Content-Type": "application/json" });
        response.end(JSON.stringify(resolved ? { ok: true } : { error: "Approval not found" }));
        return;
      }

      if (url.pathname === "/workbench/model" && request.method === "POST") {
        const body = workbenchModelBodySchema.parse(await readJsonBody(request));
        const events = await this.agent.setModel(body.threadId, body.modelId);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, events }));
        return;
      }

      if (url.pathname === "/workbench/access" && request.method === "POST") {
        const body = workbenchAccessBodySchema.parse(await readJsonBody(request));
        const events = await this.agent.setAccessLevel(body.threadId, body.accessLevel);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, events }));
        return;
      }

      if (url.pathname === "/workbench/fork" && request.method === "POST") {
        const body = workbenchForkBodySchema.parse(await readJsonBody(request));
        const newThreadId = await this.agent.forkThread(body.threadId);
        response.writeHead(newThreadId ? 200 : 404, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify(
            newThreadId ? { ok: true, threadId: newThreadId } : { error: "Thread not found" },
          ),
        );
        return;
      }

      if (url.pathname === "/workbench/run" && request.method === "POST") {
        const body = readWorkbenchRunBody(await readJsonBody(request));
        timingThreadId = body.threadId;
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        try {
          await this.agent.runWorkbench(body, (event) =>
            response.write(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch (error) {
          console.error("[workbench] run failed", error);
          response.write(
            `data: ${JSON.stringify({ type: "error", message: errorMessage(error) })}\n\n`,
          );
        }
        response.end();
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
    } finally {
      logWorkbenchServerTiming(`http ${request.method ?? "GET"} ${url.pathname}`, startedAt, {
        statusCode: response.statusCode,
        threadId: url.searchParams.get("threadId") ?? timingThreadId,
      });
    }
  }

  private startInfo(port: number): RuntimeWorkbenchServerInfo {
    const baseUrl = `http://${loopbackHost}:${port}`;
    const query = `token=${encodeURIComponent(this.auth.token)}`;
    return {
      workbenchUrl: `${baseUrl}/workbench/run?${query}`,
      threadsUrl: `${baseUrl}/workbench/threads?${query}`,
      logoutUrl: `${baseUrl}/workbench/logout?${query}`,
      token: this.auth.token,
      port,
    };
  }
}

function defaultWorkbenchCwd<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeWorkbenchAgentOptions<TState, TServices>): string {
  return options.sessions?.defaultCwd ?? runtimeOverride(options)?.workspace?.cwd ?? process.cwd();
}

function runtimeBaseFactory<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(
  options: RuntimeWorkbenchAgentOptions<TState, TServices>,
): RuntimeFactory<TState, TServices, RuntimeHandleHarness<TState>> {
  const factory = options.runtime?.factory;
  if (!factory) throw new Error("Runtime workbench agent requires runtime.factory.");
  return factory;
}

function runtimeOverride<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(
  options: RuntimeWorkbenchAgentOptions<TState, TServices>,
): RuntimeHandle<TState, TServices, RuntimeHandleHarness<TState>> | undefined {
  return options.runtime?.override;
}

function runtimeDescriptor<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeWorkbenchAgentOptions<TState, TServices>): RuntimeDescriptor {
  return options.runtime?.descriptor ?? runtimeBaseFactory(options).descriptor;
}

function runtimeAuthProfile<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeWorkbenchAgentOptions<TState, TServices>): RuntimeAuthProfile | undefined {
  return options.runtime?.auth ?? runtimeBaseFactory(options).auth;
}

function runtimeFactory<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(
  options: RuntimeWorkbenchAgentOptions<TState, TServices>,
): RuntimeFactory<TState, TServices, RuntimeHandleHarness<TState>> {
  const override = runtimeOverride(options);
  if (!override) return runtimeBaseFactory(options);

  return {
    descriptor: runtimeDescriptor(options),
    auth: runtimeAuthProfile(options),
    create: async () => override,
  };
}

async function readRuntimeSessionInfoMessages<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(
  manager: RuntimeProtocolSessions<TState, TServices>,
  info: RuntimeProtocolSessionInfo,
): Promise<RuntimeThreadMessage[]> {
  return manager.readListedMessages(info);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString("utf-8");
  return body.length > 0 ? JSON.parse(body) : {};
}

function addCommonHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, authorization, x-runtime-local-token, x-runtime-workbench-token, x-pea-local-token, x-pea-workbench-token",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(500, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }),
  );
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

function logWorkbenchServerTiming(
  label: string,
  startedAt: number,
  details: Record<string, unknown>,
): void {
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs < 100) return;
  console.info("[workbench timing]", label, { elapsedMs, ...details });
}

function isUnknownSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Unknown Runtime session:");
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
