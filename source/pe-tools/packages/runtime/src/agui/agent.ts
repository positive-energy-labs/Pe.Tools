import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  EventType,
  RunAgentInputSchema,
  type AgentCapabilities,
  type BaseEvent,
  type Context,
  type Message,
  type RunAgentInput,
} from "@ag-ui/core";
import {
  createRuntimeLocalTransportAuth,
  type RuntimeLocalTransportAuth,
} from "../transport.js";
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
} from "../runtime.ts";
import {
  RuntimeInterruptCollector,
  toRuntimeResumeDecisions,
} from "../interrupts.ts";
import {
  createRuntimePrompt,
  type RuntimePrompt,
  type RuntimePromptPart,
} from "../prompts.ts";
import {
  RuntimeProtocolSessions,
  type RuntimeProtocolSessionInfo,
} from "../session/protocol-sessions.ts";
import { describeRuntimeProtocolStatus } from "../protocol-status.ts";
import type { RuntimeResource } from "../resources.ts";
import { defaultRuntimeSessionRegistryPath } from "../session/session-registry.ts";
import { sanitizeJson } from "../events.ts";
import { RuntimeToAgUiEvents } from "./events-map-runtime-agui.ts";

export interface RuntimeAgUiRuntimeOptions {
  factory: RuntimeFactory;
  descriptor?: RuntimeDescriptor;
  auth?: RuntimeAuthProfile;
  override?: RuntimeHandle;
}

export interface RuntimeAgUiSessionOptions {
  defaultCwd?: string;
  manager?: RuntimeProtocolSessions;
  registryPath?: string | null;
}

export interface RuntimeAgUiTransportOptions {
  port?: number;
  token?: string;
}

export interface RuntimeAgUiAgentOptions {
  runtime?: RuntimeAgUiRuntimeOptions;
  sessions?: RuntimeAgUiSessionOptions;
  transport?: RuntimeAgUiTransportOptions;
}

export interface RuntimeAgUiServerInfo {
  runUrl: string;
  statusUrl: string;
  sessionsUrl: string;
  eventsUrl: string;
  logoutUrl: string;
  token: string;
  port: number;
}

const defaultPort = 43112;
const loopbackHost = "127.0.0.1";

export class RuntimeAgUiAgent {
  private readonly runtimeSessions: RuntimeProtocolSessions;

  constructor(private readonly options: RuntimeAgUiAgentOptions) {
    this.runtimeSessions =
      options.sessions?.manager ??
      options.runtimeSessions ??
      new RuntimeProtocolSessions({
        factory: runtimeFactory(options),
        idPrefix: "runtime-agui",
        defaultCwd: defaultAgUiCwd(options),
        sessionRegistryPath: agUiSessionRegistryPath(options),
      });
  }

  async run(
    input: RunAgentInput,
    emit: (event: BaseEvent) => void,
  ): Promise<void> {
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
      this.runtimeSessions.history(session.id),
    );
    const emitEvent = (event: BaseEvent) => {
      const sequencedEvent = {
        ...event,
        sequence: nextSequence++,
      };
      this.runtimeSessions.recordProtocolEvent(
        session.id,
        "ag-ui",
        sequencedEvent,
      );
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

    try {
      const stopReason = await this.runtimeSessions.sendPrompt(
        session.id,
        agUiPrompt(parsed),
      );
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

  sessions(): RuntimeProtocolSessionInfo[] {
    return this.runtimeSessions.listSessions({ protocol: "ag-ui" });
  }

  closeThread(threadId: string): boolean {
    const session = this.sessionForThread(threadId);
    if (!session) return false;
    try {
      this.runtimeSessions.close(session.id);
    } catch (error) {
      if (!isUnknownSessionError(error)) throw error;
    }
    return true;
  }

  deleteThread(threadId: string): boolean {
    const session = this.sessionForThread(threadId);
    if (!session) return false;
    this.runtimeSessions.delete(session.id);
    return true;
  }

  events(request: { threadId: string; afterSequence?: number }): BaseEvent[] {
    const session = this.sessionForThread(request.threadId);
    if (!session) return [];

    return this.runtimeSessions
      .history(session.id)
      .filter(isAgUiProtocolHistoryEntry)
      .flatMap((entry): BaseEvent[] =>
        isAgUiEvent(entry.payload) ? [entry.payload] : [],
      )
      .filter(
        (event) => agUiEventSequence(event) > (request.afterSequence ?? 0),
      );
  }

  capabilities(): AgentCapabilities {
    return agUiCapabilities(this.options);
  }

  async logout(): Promise<void> {
    await logoutRuntimeAuth(runtimeAuthProfile(this.options));
  }

  async close(): Promise<void> {
    this.runtimeSessions.closeAll();
  }

  private sessionForThread(
    threadId: string,
  ): RuntimeProtocolSessionInfo | undefined {
    return this.sessions().find(
      (candidate) => candidate.externalThreadId === threadId,
    );
  }
}

function agUiSessionRegistryPath(
  options: RuntimeAgUiAgentOptions,
): string | null | undefined {
  if (
    options.sessions?.manager ||
    options.runtimeSessions ||
    runtimeOverride(options)
  )
    return undefined;
  const registryPath =
    options.sessions?.registryPath ?? options.sessionRegistryPath;
  if (registryPath === null) return null;
  return (
    registryPath ??
    defaultRuntimeSessionRegistryPath({
      runtimeId: runtimeDescriptor(options).id,
      protocol: "ag-ui",
    })
  );
}

function agUiTransport(
  options: RuntimeAgUiAgentOptions,
): RuntimeAgUiTransportOptions {
  return {
    port: options.transport?.port ?? options.port,
    token: options.transport?.token ?? options.token,
  };
}

export class RuntimeAgUiHttpAgent {
  private readonly auth: RuntimeLocalTransportAuth;
  private server: ReturnType<typeof createServer> | null = null;
  private agent: RuntimeAgUiAgent;

  constructor(private readonly options: RuntimeAgUiAgentOptions) {
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
      this.handle(request, response).catch((error) =>
        writeError(response, error),
      );
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(port, loopbackHost, resolve),
    );
    const address = this.server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;
    return this.startInfo(actualPort);
  }

  async close(): Promise<void> {
    await this.agent.close();
    const server = this.server;
    this.server = null;
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    addCommonHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${loopbackHost}`);
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
            sessions: this.agent.sessions().length,
          }),
        ),
      );
      return;
    }

    if (url.pathname === "/agui/sessions") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ sessions: this.agent.sessions() }));
      return;
    }

    const sessionCloseMatch = /^\/agui\/sessions\/([^/]+)\/close$/.exec(
      url.pathname,
    );
    if (sessionCloseMatch && request.method === "POST") {
      const threadId = decodeURIComponent(sessionCloseMatch[1]!);
      if (!this.agent.closeThread(threadId)) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Thread not found" }));
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    const sessionDeleteMatch = /^\/agui\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionDeleteMatch && request.method === "DELETE") {
      const threadId = decodeURIComponent(sessionDeleteMatch[1]!);
      if (!this.agent.deleteThread(threadId)) {
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

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          events: this.agent.events({
            threadId,
            afterSequence: parseOptionalSequence(
              url.searchParams.get("afterSequence"),
            ),
          }),
        }),
      );
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
  }

  private startInfo(port: number): RuntimeAgUiServerInfo {
    const baseUrl = `http://${loopbackHost}:${port}`;
    const query = `token=${encodeURIComponent(this.auth.token)}`;
    return {
      runUrl: `${baseUrl}/agui/run?${query}`,
      statusUrl: `${baseUrl}/agui/status?${query}`,
      sessionsUrl: `${baseUrl}/agui/sessions?${query}`,
      eventsUrl: `${baseUrl}/agui/events?${query}`,
      logoutUrl: `${baseUrl}/agui/logout?${query}`,
      token: this.auth.token,
      port,
    };
  }
}

function agUiPrompt(input: RunAgentInput): RuntimePrompt {
  const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
  const lastUserMessage =
    lastUserMessageIndex >= 0
      ? input.messages[lastUserMessageIndex]
      : undefined;
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

function agUiRuntimeScope(
  input: RunAgentInput,
  defaultCwd: string,
): RuntimeAgUiScope {
  const forwardedProps = isRecord(input.forwardedProps)
    ? input.forwardedProps
    : {};
  const peaProps = isRecord(forwardedProps.pea) ? forwardedProps.pea : {};
  return {
    cwd: firstString(peaProps.cwd, forwardedProps.cwd) ?? defaultCwd,
    additionalDirectories: stringArray(
      peaProps.additionalDirectories ?? forwardedProps.additionalDirectories,
    ),
  };
}

function defaultAgUiCwd(options: RuntimeAgUiAgentOptions): string {
  return (
    options.sessions?.defaultCwd ??
    options.workspaceRoot ??
    runtimeOverride(options)?.workspace?.cwd ??
    process.cwd()
  );
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
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content))
    return [{ text: messageText(message) }].filter((part) => part.text);

  return content.map((part, index) => {
    if (
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string"
    ) {
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
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part, index) => {
        if (
          isRecord(part) &&
          part.type === "text" &&
          typeof part.text === "string"
        )
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

function agUiInputResource(
  messageId: string,
  index: number,
  part: unknown,
): RuntimeResource {
  const record = isRecord(part) ? part : {};
  const type = typeof record.type === "string" ? record.type : "input";
  const source = isRecord(record.source) ? record.source : undefined;
  const mimeType =
    typeof record.mimeType === "string"
      ? record.mimeType
      : source && typeof source.mimeType === "string"
        ? source.mimeType
        : undefined;

  if (type === "binary") {
    const filename =
      typeof record.filename === "string" ? record.filename : undefined;
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
    metadata:
      record.metadata === undefined ? undefined : sanitizeJson(record.metadata),
  };
}

function contextEntries(context: Context[]): Context[] {
  return context.map((entry) => ({
    value: entry.value,
    description: entry.description,
  }));
}

function runtimeBaseFactory(options: RuntimeAgUiAgentOptions): RuntimeFactory {
  const factory = options.runtime?.factory ?? options.factory;
  if (!factory)
    throw new Error("Runtime AG-UI agent requires runtime.factory.");
  return factory;
}

function runtimeOverride(
  options: RuntimeAgUiAgentOptions,
): RuntimeHandle | undefined {
  return options.runtime?.override ?? options.runtimeOverride;
}

function runtimeDescriptor(
  options: RuntimeAgUiAgentOptions,
): RuntimeDescriptor {
  return (
    options.runtime?.descriptor ??
    options.descriptor ??
    runtimeBaseFactory(options).descriptor
  );
}

function runtimeAuthProfile(
  options: RuntimeAgUiAgentOptions,
): RuntimeAuthProfile | undefined {
  return (
    options.runtime?.auth ?? options.auth ?? runtimeBaseFactory(options).auth
  );
}

function runtimeAuthDescriptor(
  options: RuntimeAgUiAgentOptions,
): RuntimeAuthDescriptor {
  return (
    runtimeAuthProfile(options)?.descriptor ??
    createRuntimeAuthDescriptor({ source: "none", methods: [] })
  );
}

function runtimeFactory(options: RuntimeAgUiAgentOptions): RuntimeFactory {
  const override = runtimeOverride(options);
  if (!override) return runtimeBaseFactory(options);

  return {
    descriptor: runtimeDescriptor(options),
    auth: runtimeAuthProfile(options),
    create: async () => override,
  };
}

function agUiCapabilities(options: RuntimeAgUiAgentOptions): AgentCapabilities {
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
  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS",
  );
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

function parseOptionalSequence(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nextAgUiEventSequence(
  history: ReturnType<RuntimeProtocolSessions["history"]>,
): number {
  const sequences = history
    .filter(isAgUiProtocolHistoryEntry)
    .map((entry) => agUiEventSequence(entry.payload));
  return Math.max(0, ...sequences) + 1;
}

function isAgUiProtocolHistoryEntry(
  entry: ReturnType<RuntimeProtocolSessions["history"]>[number],
): entry is Extract<
  ReturnType<RuntimeProtocolSessions["history"]>[number],
  { type: "protocol_event" }
> {
  return entry.type === "protocol_event" && entry.protocol === "ag-ui";
}

function isAgUiEvent(value: unknown): value is BaseEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function isUnknownSessionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Unknown Runtime session:")
  );
}

function agUiEventSequence(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const sequence = (value as { sequence?: unknown }).sequence;
  return typeof sequence === "number" && Number.isFinite(sequence)
    ? sequence
    : 0;
}

function isMeaningfulJson(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const sanitized = sanitizeJson(value);
  if (Array.isArray(sanitized)) return sanitized.length > 0;
  if (typeof sanitized === "object" && sanitized !== null)
    return Object.keys(sanitized).length > 0;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
}

export type PeaAgUiAgentOptions = RuntimeAgUiAgentOptions;
export type PeaAgUiServerInfo = RuntimeAgUiServerInfo;
export type PeaAgUiRuntimeId = string;
export {
  RuntimeAgUiAgent as PeaAgUiAgent,
  RuntimeAgUiHttpAgent as PeaAgUiHttpAgent,
};
