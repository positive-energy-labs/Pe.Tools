import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { WorkbenchEvent, WorkbenchThreadInfo } from "@pe/agent-contracts";
import { createRuntimeLocalTransportAuth, type RuntimeLocalTransportAuth } from "../transport.js";
import { logoutRuntimeAuth, type RuntimeAuthProfile } from "../auth/types.ts";
import type {
  RuntimeDescriptor,
  RuntimeFactory,
  RuntimeHandle,
  RuntimeHandleHarness,
  RuntimeHandleServices,
  RuntimeThreadMessage,
} from "../runtime.ts";
import { createRuntimePrompt } from "../prompts.ts";
import {
  RuntimeProtocolSessions,
  type RuntimeProtocolSessionInfo,
} from "../session/protocol-sessions.ts";
import type { RuntimeThreadIndex } from "../storage/thread-index.ts";
import {
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

export class RuntimeWorkbenchAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  private readonly runtimeSessions: RuntimeProtocolSessions<TState, TServices>;

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
    });

    try {
      emit({ type: "run_status_changed", status: "running", timestamp });
      await this.runtimeSessions.sendPrompt(session.id, createRuntimePrompt([{ text: body.text }]));
      // The system-prompt capture + final-tool-list sink populate the live handle metadata
      // during the run, so the breakdown is ready once sendPrompt resolves.
      const inspector = await contextInspectorUpdate(session);
      if (inspector) emit(inspector);
      emit({ type: "run_status_changed", status: "idle", timestamp: new Date().toISOString() });
    } catch (error) {
      emit({ type: "error", message: errorMessage(error) });
      emit({ type: "run_status_changed", status: "error", timestamp: new Date().toISOString() });
    } finally {
      unsubscribe();
    }
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

interface WorkbenchRunBody {
  threadId: string;
  text: string;
  cwd?: string;
  additionalDirectories?: string[];
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
  };
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

const workbenchRunBodySchema = z.object({
  threadId: z.string(),
  text: z.string(),
  cwd: z.string().optional(),
  additionalDirectories: z.array(z.string()).optional(),
});

function readWorkbenchRunBody(value: unknown): WorkbenchRunBody {
  return workbenchRunBodySchema.parse(value);
}

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
