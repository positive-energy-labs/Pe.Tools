import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  EventType,
  RunAgentInputSchema,
  type AgentCapabilities,
  type BaseEvent,
  type Context,
  type Message,
  type RunAgentInput,
} from "@ag-ui/core";
import type { PeWorkbenchUpdateMetadata } from "@pe/agent-contracts";
import { createRuntimeLocalTransportAuth, type RuntimeLocalTransportAuth } from "../transport.js";
import {
  createRuntimeAuthDescriptor,
  logoutRuntimeAuth,
  type RuntimeAuthDescriptor,
  type RuntimeAuthProfile,
} from "../auth/types.ts";
import { toAgUiAuthCapabilities } from "../auth/protocol.ts";
import type {
  RuntimeDescriptor,
  RuntimeFactory,
  RuntimeHandle,
  RuntimeHandleHarness,
  RuntimeHandleServices,
  RuntimeLedgerEntry,
  RuntimeThreadMessage,
} from "../runtime.ts";
import { RuntimeInterruptCollector, toRuntimeResumeDecisions } from "../interrupts.ts";
import { createRuntimePrompt, type RuntimePrompt, type RuntimePromptPart } from "../prompts.ts";
import {
  RuntimeProtocolSessions,
  type RuntimeProtocolSessionInfo,
} from "../session/protocol-sessions.ts";
import { describeRuntimeProtocolStatus } from "../protocol-status.ts";
import type { RuntimeResource } from "../resources.ts";
import type {
  RuntimeRawThreadDatabaseSnapshot,
  RuntimeThreadIndex,
} from "../storage/thread-index.ts";
import { sanitizeJson } from "../events.ts";
import { RuntimeToAgUiEvents } from "./events-map-runtime-agui.ts";
import { z } from "zod";

export interface RuntimeAgUiRuntimeOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  factory: RuntimeFactory<TState, TServices>;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  override?: RuntimeHandle<TState, TServices>;
}

export interface RuntimeAgUiSessionOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  defaultCwd?: string;
  manager?: RuntimeProtocolSessions<TState, TServices>;
  threadIndex?: RuntimeThreadIndex;
}

export interface RuntimeAgUiTransportOptions {
  port?: number;
  token?: string;
}

export interface RuntimeAgUiAgentOptions<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  runtime?: RuntimeAgUiRuntimeOptions<TState, TServices>;
  sessions?: RuntimeAgUiSessionOptions<TState, TServices>;
  transport?: RuntimeAgUiTransportOptions;
}

export interface RuntimeAgUiServerInfo {
  runUrl: string;
  statusUrl: string;
  threadsUrl: string;
  sessionsUrl: string;
  eventsUrl: string;
  messagesUrl: string;
  threadRawUrl: string;
  logoutUrl: string;
  token: string;
  port: number;
}

export interface RuntimeAgUiRawThreadSnapshot {
  generatedAt: string;
  requestedThreadId: string;
  session?: RuntimeProtocolSessionInfo;
  messages: RuntimeThreadMessage[];
  ledger: RuntimeLedgerEntry[];
  history: unknown[];
  database?: RuntimeRawThreadDatabaseSnapshot;
  errors: string[];
}

const defaultPort = 43112;
const loopbackHost = "127.0.0.1";

export class RuntimeAgUiAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  private readonly runtimeSessions: RuntimeProtocolSessions<TState, TServices>;

  constructor(private readonly options: RuntimeAgUiAgentOptions<TState, TServices>) {
    this.runtimeSessions =
      options.sessions?.manager ??
      new RuntimeProtocolSessions({
        factory: runtimeFactory(options),
        defaultCwd: defaultAgUiCwd(options),
        threadIndex: options.sessions?.threadIndex,
      });
  }

  async run(input: RunAgentInput, emit: (event: BaseEvent) => void): Promise<void> {
    const parsed = RunAgentInputSchema.parse(input);
    const runtimeScope = agUiRuntimeScope(parsed, defaultAgUiCwd(this.options));
    const session = await this.runtimeSessions.getOrCreateThreadSession({
      protocol: "ag-ui",
      externalThreadId: parsed.threadId,
      cwd: runtimeScope.cwd,
      additionalDirectories: runtimeScope.additionalDirectories,
      title: `AG-UI ${parsed.threadId}`,
    });

    const translator = new RuntimeToAgUiEvents();
    const interrupts = new RuntimeInterruptCollector();
    let nextSequence = nextAgUiEventSequence(
      await readRuntimeSessionHistory(this.runtimeSessions, session.id),
    );
    const emitEvent = (event: BaseEvent) => {
      const sequencedEvent = {
        ...event,
        sequence: nextSequence++,
      };
      this.runtimeSessions.recordProtocolEvent(session.id, "ag-ui", sequencedEvent);
      emit(sequencedEvent);
    };
    const unsubscribe = this.runtimeSessions.subscribe(session.id, (event) => {
      interrupts.observe(event);
      for (const agUiEvent of translator.translate(event)) emitEvent(agUiEvent);
    });

    emitEvent({
      type: EventType.RUN_STARTED,
      threadId: parsed.threadId,
      runId: parsed.runId,
      parentRunId: parsed.parentRunId,
      input: parsed,
    });
    emitEvent({ type: EventType.STATE_SNAPSHOT, snapshot: parsed.state ?? {} });
    emitEvent({ type: EventType.MESSAGES_SNAPSHOT, messages: parsed.messages });
    for (const event of translator.translate({
      type: "workbench_metadata_updated",
      metadata: runtimeWorkbenchMetadata(session.runtime),
    })) {
      emitEvent(event);
    }

    try {
      const stopReason = await this.runtimeSessions.sendPrompt(session.id, agUiPrompt(parsed));
      // Re-emit after the prompt resolves so a capture processor's snapshot
      // (e.g. the resolved system prompt) reaches the client this same turn.
      for (const event of translator.translate({
        type: "workbench_metadata_updated",
        metadata: runtimeWorkbenchMetadata(session.runtime),
      })) {
        emitEvent(event);
      }
      emitEvent({
        type: EventType.RUN_FINISHED,
        threadId: parsed.threadId,
        runId: parsed.runId,
        outcome: interrupts.outcome(),
        rawEvent: { stopReason },
      });
    } catch (error) {
      emitEvent({
        type: EventType.RUN_ERROR,
        threadId: parsed.threadId,
        runId: parsed.runId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      unsubscribe();
    }
  }

  async sessions(): Promise<RuntimeProtocolSessionInfo[]> {
    const startedAt = performance.now();
    const sessions = await this.runtimeSessions.listSessions({ protocol: "ag-ui" });
    logAgUiServerTiming("agent.sessions", startedAt, { sessions: sessions.length });
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

  async events(request: { threadId: string; afterSequence?: number }): Promise<BaseEvent[]> {
    const startedAt = performance.now();
    const listedSession = await this.sessionForThread(request.threadId);
    if (!listedSession) {
      logAgUiServerTiming("agent.events missing", startedAt, { threadId: request.threadId });
      return [];
    }
    const afterSequence = request.afterSequence ?? 0;
    if (afterSequence >= 0 && !listedSession.promptActive) {
      logAgUiServerTiming("agent.events idle", startedAt, {
        threadId: request.threadId,
        afterSequence,
      });
      return [];
    }

    const session = await this.runtimeSessions.resumeSession(listedSession.id, {
      cwd: listedSession.cwd,
      additionalDirectories: listedSession.additionalDirectories,
      protocol: listedSession.protocol,
    });
    const metadataEvents = runtimeWorkbenchMetadataEvents(session.runtime);
    const history = await readRuntimeSessionInfoHistory(this.runtimeSessions, listedSession);
    const protocolEvents = history
      .filter(isAgUiProtocolHistoryEntry)
      .flatMap((entry): BaseEvent[] => (isAgUiEvent(entry.payload) ? [entry.payload] : []));
    if (protocolEvents.length > 0) {
      const events = [...metadataEvents, ...protocolEvents].filter(
        (event) => agUiEventSequence(event) > afterSequence,
      );
      logAgUiServerTiming("agent.events protocol", startedAt, {
        threadId: request.threadId,
        events: events.length,
      });
      return events;
    }

    const fallbackEvents = runtimeMessagesSnapshotEvents(
      await readRuntimeSessionInfoMessages(this.runtimeSessions, listedSession),
      listedSession,
    );
    const events = [...metadataEvents, ...fallbackEvents].filter(
      (event) => agUiEventSequence(event) > afterSequence,
    );
    logAgUiServerTiming("agent.events fallback", startedAt, {
      threadId: request.threadId,
      events: events.length,
    });
    return events;
  }

  async messages(request: { threadId: string }): Promise<Message[]> {
    const startedAt = performance.now();
    const listedSession = await this.sessionForThread(request.threadId);
    if (!listedSession) {
      logAgUiServerTiming("agent.messages missing", startedAt, { threadId: request.threadId });
      return [];
    }
    const messages = runtimeThreadMessagesToAgUiMessages(
      await readRuntimeSessionInfoMessages(this.runtimeSessions, listedSession),
    );
    logAgUiServerTiming("agent.messages", startedAt, {
      threadId: request.threadId,
      messages: messages.length,
    });
    return messages;
  }

  async rawThread(request: { threadId: string }): Promise<RuntimeAgUiRawThreadSnapshot> {
    const errors: string[] = [];
    const listedSession = await this.sessionForThread(request.threadId);
    if (!listedSession) {
      return {
        generatedAt: new Date().toISOString(),
        requestedThreadId: request.threadId,
        messages: [],
        ledger: [],
        history: [],
        errors: [`Thread not found: ${request.threadId}`],
      };
    }

    const messages = await readRuntimeSessionInfoMessages(
      this.runtimeSessions,
      listedSession,
    ).catch((error: unknown) => {
      errors.push(`messages: ${errorMessage(error)}`);
      return [];
    });
    const ledger = await this.runtimeSessions
      .readListedLedger(listedSession)
      .catch((error: unknown) => {
        errors.push(`ledger: ${errorMessage(error)}`);
        return [];
      });
    const history = await readRuntimeSessionInfoHistory(this.runtimeSessions, listedSession).catch(
      (error: unknown) => {
        errors.push(`history: ${errorMessage(error)}`);
        return [];
      },
    );
    const database =
      listedSession.threadId && this.options.sessions?.threadIndex?.readThreadDatabaseSnapshot
        ? await this.options.sessions.threadIndex
            .readThreadDatabaseSnapshot({
              threadId: listedSession.threadId,
              resourceId: listedSession.resourceId,
            })
            .catch((error: unknown) => {
              errors.push(`database: ${errorMessage(error)}`);
              return undefined;
            })
        : undefined;

    return {
      generatedAt: new Date().toISOString(),
      requestedThreadId: request.threadId,
      session: listedSession,
      messages,
      ledger,
      history: sanitizeJson(history) as unknown[],
      ...(database ? { database } : {}),
      errors,
    };
  }

  capabilities(): AgentCapabilities {
    return agUiCapabilities(this.options);
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

function agUiTransport<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): RuntimeAgUiTransportOptions {
  return options.transport ?? {};
}

export class RuntimeAgUiHttpAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TServices extends RuntimeHandleServices = RuntimeHandleServices,
> {
  private readonly auth: RuntimeLocalTransportAuth;
  private server: ReturnType<typeof createServer> | null = null;
  private agent: RuntimeAgUiAgent<TState, TServices>;

  constructor(private readonly options: RuntimeAgUiAgentOptions<TState, TServices>) {
    this.auth = createRuntimeLocalTransportAuth({
      token: agUiTransport(options).token,
      headerNames: [
        "x-runtime-local-token",
        "x-runtime-agui-token",
        "x-pea-local-token",
        "x-pea-agui-token",
      ],
    });
    this.agent = new RuntimeAgUiAgent(options);
  }

  async start(): Promise<RuntimeAgUiServerInfo> {
    const port = agUiTransport(this.options).port ?? defaultPort;
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

      if (url.pathname === "/agui/status") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify(
            describeRuntimeProtocolStatus({
              runtime: runtimeDescriptor(this.options),
              protocol: "ag-ui",
              transport: "http+sse",
              auth: runtimeAuthDescriptor(this.options),
              capabilities: this.agent.capabilities(),
              sessions: (await this.agent.sessions()).length,
            }),
          ),
        );
        return;
      }

      if (url.pathname === "/agui/threads" || url.pathname === "/agui/sessions") {
        const threads = await this.agent.sessions();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ threads, sessions: threads }));
        return;
      }

      const threadCloseMatch = /^\/agui\/(?:threads|sessions)\/([^/]+)\/close$/.exec(url.pathname);
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

      const threadDeleteMatch = /^\/agui\/(?:threads|sessions)\/([^/]+)$/.exec(url.pathname);
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

      if (url.pathname === "/agui/events") {
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "threadId is required" }));
          return;
        }

        const events = await this.agent.events({
          threadId,
          afterSequence: parseOptionalSequence(url.searchParams.get("afterSequence")),
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ events }));
        return;
      }

      if (url.pathname === "/agui/messages") {
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "threadId is required" }));
          return;
        }

        const messages = await this.agent.messages({ threadId });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ messages }));
        return;
      }

      if (url.pathname === "/agui/thread-raw") {
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "threadId is required" }));
          return;
        }

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(await this.agent.rawThread({ threadId })));
        return;
      }

      if (url.pathname === "/agui/logout" && request.method === "POST") {
        const logoutSupported =
          this.agent.capabilities().custom?.["runtime.logoutSupported"] === true;
        if (!logoutSupported) {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              error: "Logout is not supported for this runtime.",
            }),
          );
          return;
        }

        await this.agent.logout();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === "/agui/run" && request.method === "POST") {
        const input = RunAgentInputSchema.parse(await readJsonBody(request));
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        await this.agent.run(input, (event) =>
          response.write(`data: ${JSON.stringify(event)}\n\n`),
        );
        response.end();
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
    } finally {
      logAgUiServerTiming(`http ${request.method ?? "GET"} ${url.pathname}`, startedAt, {
        statusCode: response.statusCode,
        threadId: url.searchParams.get("threadId") ?? undefined,
      });
    }
  }

  private startInfo(port: number): RuntimeAgUiServerInfo {
    const baseUrl = `http://${loopbackHost}:${port}`;
    const query = `token=${encodeURIComponent(this.auth.token)}`;
    return {
      runUrl: `${baseUrl}/agui/run?${query}`,
      statusUrl: `${baseUrl}/agui/status?${query}`,
      threadsUrl: `${baseUrl}/agui/threads?${query}`,
      sessionsUrl: `${baseUrl}/agui/sessions?${query}`,
      eventsUrl: `${baseUrl}/agui/events?${query}`,
      messagesUrl: `${baseUrl}/agui/messages?${query}`,
      threadRawUrl: `${baseUrl}/agui/thread-raw?${query}`,
      logoutUrl: `${baseUrl}/agui/logout?${query}`,
      token: this.auth.token,
      port,
    };
  }
}

function agUiPrompt(input: RunAgentInput): RuntimePrompt {
  const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
  const lastUserMessage =
    lastUserMessageIndex >= 0 ? input.messages[lastUserMessageIndex] : undefined;
  const priorMessages =
    lastUserMessageIndex >= 0
      ? input.messages.filter((_, index) => index !== lastUserMessageIndex)
      : input.messages;
  const parts: RuntimePromptPart[] = [
    ...(lastUserMessage
      ? messagePromptParts(lastUserMessage)
      : input.messages.flatMap((message) => messagePromptParts(message))),
    ...contextEntries(input.context).map((entry) => ({
      contextDescription: entry.description,
      contextValue: entry.value,
    })),
  ];

  if (priorMessages.length > 0) {
    parts.push({
      contextDescription: "AG-UI conversation messages supplied by the client",
      contextValue: priorMessages.map((message) => ({
        id: message.id,
        role: message.role,
        text: messageText(message),
      })),
    });
  }
  if (isMeaningfulJson(input.state)) {
    parts.push({
      contextDescription: "AG-UI thread state supplied by the client",
      contextValue: input.state,
    });
  }
  if (input.tools.length > 0) {
    parts.push({
      contextDescription: "AG-UI client-provided tools visible to the frontend",
      contextValue: input.tools,
    });
  }
  const forwardedProps = stripRuntimeAgUiForwardedProps(input.forwardedProps);
  if (isMeaningfulJson(forwardedProps)) {
    parts.push({
      contextDescription: "AG-UI forwarded properties supplied by the client",
      contextValue: forwardedProps,
    });
  }

  return {
    ...createRuntimePrompt(parts),
    resumeDecisions: toRuntimeResumeDecisions(input.resume),
  };
}

interface RuntimeAgUiScope {
  cwd: string;
  additionalDirectories: string[];
}

function agUiRuntimeScope(input: RunAgentInput, defaultCwd: string): RuntimeAgUiScope {
  const forwardedProps = isRecord(input.forwardedProps) ? input.forwardedProps : {};
  const peaProps = isRecord(forwardedProps.pea) ? forwardedProps.pea : {};
  return {
    cwd: firstString(peaProps.cwd, forwardedProps.cwd) ?? defaultCwd,
    additionalDirectories: stringArray(
      peaProps.additionalDirectories ?? forwardedProps.additionalDirectories,
    ),
  };
}

function defaultAgUiCwd<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): string {
  return options.sessions?.defaultCwd ?? runtimeOverride(options)?.workspace?.cwd ?? process.cwd();
}

function stripRuntimeAgUiForwardedProps(forwardedProps: unknown): unknown {
  if (!isRecord(forwardedProps)) return forwardedProps;
  const stripped = { ...forwardedProps };
  delete stripped.pea;
  delete stripped.cwd;
  delete stripped.additionalDirectories;
  return stripped;
}

function messagePromptParts(message: Message | undefined): RuntimePromptPart[] {
  if (!message) return [];
  const content = readRecord(message)?.content;
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: messageText(message) }].filter((part) => part.text);

  return content.map((part, index) => {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      return { text: part.text };
    }

    const resource = agUiInputResource(message.id, index, part);
    return {
      text: `[AG-UI ${resource.title ?? resource.kind} input: ${resource.uri ?? resource.name ?? resource.id}]`,
      resource,
    };
  });
}

function findLastUserMessageIndex(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function messageText(message: Message | undefined): string {
  if (!message) return "";
  const content = readRecord(message)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part, index) => {
        if (isRecord(part) && part.type === "text" && typeof part.text === "string")
          return part.text;
        const resource = agUiInputResource(message.id, index, part);
        return `[AG-UI ${resource.title ?? resource.kind} input: ${resource.uri ?? resource.name ?? resource.id}]`;
      })
      .filter(Boolean)
      .join("\n");
  }
  if ("toolCalls" in message || "activityType" in message)
    return JSON.stringify(sanitizeJson(message));
  return "";
}

function agUiInputResource(messageId: string, index: number, part: unknown): RuntimeResource {
  const record = readRecord(part) ?? {};
  const type = typeof record.type === "string" ? record.type : "input";
  const source = isRecord(record.source) ? record.source : undefined;
  const mimeType =
    typeof record.mimeType === "string"
      ? record.mimeType
      : source && typeof source.mimeType === "string"
        ? source.mimeType
        : undefined;

  if (type === "binary") {
    const filename = typeof record.filename === "string" ? record.filename : undefined;
    return {
      id: `ag-ui:${messageId}:${index}`,
      protocol: "ag-ui",
      kind: "input",
      uri: typeof record.url === "string" ? record.url : undefined,
      name: filename ?? (typeof record.id === "string" ? record.id : undefined),
      title: filename ?? "binary",
      mimeType,
      data: typeof record.data === "string" ? record.data : undefined,
      source: sanitizeJson(record),
    };
  }

  return {
    id: `ag-ui:${messageId}:${index}`,
    protocol: "ag-ui",
    kind: "input",
    uri:
      source && source.type === "url" && typeof source.value === "string"
        ? source.value
        : undefined,
    title: type,
    mimeType,
    data:
      source && source.type === "data" && typeof source.value === "string"
        ? source.value
        : undefined,
    source: sanitizeJson(record),
    metadata: record.metadata === undefined ? undefined : sanitizeJson(record.metadata),
  };
}

function contextEntries(context: Context[]): Context[] {
  return context.map((entry) => ({
    value: entry.value,
    description: entry.description,
  }));
}

function runtimeBaseFactory<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): RuntimeFactory<TState, TServices> {
  const factory = options.runtime?.factory;
  if (!factory) throw new Error("Runtime AG-UI agent requires runtime.factory.");
  return factory;
}

function runtimeOverride<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(
  options: RuntimeAgUiAgentOptions<TState, TServices>,
): RuntimeHandle<TState, TServices> | undefined {
  return options.runtime?.override;
}

function runtimeDescriptor<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): RuntimeDescriptor {
  return options.runtime?.descriptor ?? runtimeBaseFactory(options).descriptor;
}

function runtimeAuthProfile<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): RuntimeAuthProfile | undefined {
  return options.runtime?.auth ?? runtimeBaseFactory(options).auth;
}

function runtimeAuthDescriptor<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): RuntimeAuthDescriptor {
  return (
    runtimeAuthProfile(options)?.descriptor ??
    createRuntimeAuthDescriptor({ source: "none", methods: [] })
  );
}

function runtimeFactory<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): RuntimeFactory<TState, TServices> {
  const override = runtimeOverride(options);
  if (!override) return runtimeBaseFactory(options);

  return {
    descriptor: runtimeDescriptor(options),
    auth: runtimeAuthProfile(options),
    create: async () => override,
  };
}

function agUiCapabilities<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(options: RuntimeAgUiAgentOptions<TState, TServices>): AgentCapabilities {
  const descriptor = runtimeDescriptor(options);
  const auth = runtimeAuthDescriptor(options);
  return {
    identity: {
      name: descriptor.title,
      type: "mastra",
      description: descriptor.description,
      version: "0.1.0",
      provider: "Positive Energy",
    },
    transport: {
      streaming: true,
      websocket: false,
      resumable: true,
    },
    state: {
      snapshots: true,
      deltas: false,
      memory: true,
      persistentState: true,
    },
    tools: {
      supported: true,
      clientProvided: false,
    },
    humanInTheLoop: {
      supported: true,
      approvals: true,
      interrupts: true,
      approveWithEdits: false,
    },
    custom: {
      "runtime.id": descriptor.id,
      "runtime.sessionModel": "active-thread",
      ...toAgUiAuthCapabilities(auth),
    },
  };
}

function runtimeWorkbenchMetadataEvents<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(handle: RuntimeHandle<TState, TServices, THarness>): BaseEvent[] {
  const metadata = runtimeWorkbenchMetadata(handle);
  if (Object.keys(metadata).length === 0) return [];
  return [
    {
      type: EventType.CUSTOM,
      name: "runtime.workbench.metadata",
      value: metadata,
      sequence: 0,
    } as BaseEvent,
  ];
}

function runtimeWorkbenchMetadata<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
  THarness extends RuntimeHandleHarness<TState>,
>(handle: RuntimeHandle<TState, TServices, THarness>): PeWorkbenchUpdateMetadata {
  const metadata: PeWorkbenchUpdateMetadata = {};
  const configured = readRecord(handle.metadata?.workbench) ?? {};
  const systemPrompt = readRecord(configured.systemPrompt);
  const contextEntries = Array.isArray(configured.contextEntries)
    ? configured.contextEntries
    : undefined;
  const rawMessages = Array.isArray(configured.rawMessages) ? configured.rawMessages : undefined;
  const observationalMemory = configured.observationalMemory;

  if (typeof systemPrompt?.content === "string") {
    metadata.systemPrompt = {
      content: systemPrompt.content,
      source: typeof systemPrompt.source === "string" ? systemPrompt.source : "runtime metadata",
      metadata: runtimeJsonObject(systemPrompt.metadata),
    };
  }
  if (contextEntries)
    metadata.contextEntries = sanitizeJson(
      contextEntries,
    ) as unknown as PeWorkbenchUpdateMetadata["contextEntries"];
  if (rawMessages)
    metadata.rawMessages = sanitizeJson(
      rawMessages,
    ) as unknown as PeWorkbenchUpdateMetadata["rawMessages"];
  if (observationalMemory !== undefined)
    metadata.observationalMemory = sanitizeJson(
      observationalMemory,
    ) as unknown as PeWorkbenchUpdateMetadata["observationalMemory"];

  return metadata;
}

function runtimeJsonObject(value: unknown): PeWorkbenchUpdateMetadata["systemPrompt"] extends {
  metadata?: infer T;
}
  ? T | undefined
  : undefined {
  const sanitized = sanitizeJson(value);
  return readRecord(sanitized) as never;
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
    "content-type, authorization, x-runtime-local-token, x-runtime-agui-token, x-pea-local-token, x-pea-agui-token",
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

function logAgUiServerTiming(
  label: string,
  startedAt: number,
  details: Record<string, unknown>,
): void {
  const elapsedMs = Math.round(performance.now() - startedAt);
  if (elapsedMs < 100) return;
  console.info("[agui timing]", label, { elapsedMs, ...details });
}

function parseOptionalSequence(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nextAgUiEventSequence(history: ReturnType<RuntimeProtocolSessions["history"]>): number {
  const sequences = history
    .filter(isAgUiProtocolHistoryEntry)
    .map((entry) => agUiEventSequence(entry.payload));
  return Math.max(0, ...sequences) + 1;
}

async function readRuntimeSessionHistory<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(
  manager: RuntimeProtocolSessions<TState, TServices>,
  id: string,
): Promise<ReturnType<RuntimeProtocolSessions["history"]>> {
  return manager.readHistory(id);
}

async function readRuntimeSessionInfoHistory<
  TState extends Record<string, unknown>,
  TServices extends RuntimeHandleServices,
>(
  manager: RuntimeProtocolSessions<TState, TServices>,
  info: RuntimeProtocolSessionInfo,
): Promise<ReturnType<RuntimeProtocolSessions["history"]>> {
  return manager.readListedHistory(info);
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

function runtimeMessagesSnapshotEvents(
  messages: RuntimeThreadMessage[],
  session: RuntimeProtocolSessionInfo,
): BaseEvent[] {
  const agUiMessages = runtimeThreadMessagesToAgUiMessages(messages);
  if (agUiMessages.length === 0) return [];
  return [
    {
      type: EventType.MESSAGES_SNAPSHOT,
      threadId: session.externalThreadId ?? session.threadId ?? session.id,
      messages: agUiMessages,
      sequence: 1,
    } as BaseEvent,
  ];
}

function runtimeThreadMessagesToAgUiMessages(messages: RuntimeThreadMessage[]): Message[] {
  return messages.flatMap(runtimeThreadMessageToAgUiMessage);
}

function runtimeThreadMessageToAgUiMessage(message: RuntimeThreadMessage): Message[] {
  if (message.role !== "user" && message.role !== "assistant" && message.role !== "system")
    return [];
  return [
    {
      id: message.id,
      role: message.role,
      content: message.text,
    },
  ];
}

function isAgUiProtocolHistoryEntry(
  entry: ReturnType<RuntimeProtocolSessions["history"]>[number],
): entry is Extract<
  ReturnType<RuntimeProtocolSessions["history"]>[number],
  { type: "protocol_event" }
> {
  return entry.type === "protocol_event" && entry.protocol === "ag-ui";
}

const agUiRecordSchema = z.record(z.string(), z.unknown());
const agUiEventEnvelopeSchema = z.object({ type: z.string() }).passthrough();
const agUiStringArraySchema = z.array(z.string());

function isAgUiEvent(value: unknown): value is BaseEvent {
  return agUiEventEnvelopeSchema.safeParse(value).success;
}

function isUnknownSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Unknown Runtime session:");
}

function agUiEventSequence(value: unknown): number {
  const sequence = readRecord(value)?.sequence;
  return typeof sequence === "number" && Number.isFinite(sequence) ? sequence : 0;
}

function isMeaningfulJson(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const sanitized = sanitizeJson(value);
  if (Array.isArray(sanitized)) return sanitized.length > 0;
  if (typeof sanitized === "object" && sanitized !== null) return Object.keys(sanitized).length > 0;
  return true;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  const record = agUiRecordSchema.safeParse(value);
  return record.success ? record.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return agUiRecordSchema.safeParse(value).success;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function stringArray(value: unknown): string[] {
  const entries = agUiStringArraySchema.safeParse(value);
  return entries.success ? entries.data.filter((entry) => entry.trim().length > 0) : [];
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
