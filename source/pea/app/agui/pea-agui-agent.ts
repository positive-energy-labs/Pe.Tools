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
import type { DevAgentRuntime, PeaAgentOptions, PeaRuntime } from "../pea-runtime.js";
import {
  createPeaLocalTransportAuth,
  type PeaLocalTransportAuth,
} from "../pea-local-transport-auth.js";
import {
  describePeaRuntimeAuth,
  logoutPeaRuntimeAuth,
  toAgUiAuthCapabilities,
} from "../pea-runtime-auth.js";
import { describePeaRuntime } from "../pea-runtime-factory.js";
import {
  PeaRuntimeInterruptCollector,
  toPeaRuntimeResumeDecisions,
} from "../pea-runtime-interrupts.js";
import {
  createPeaRuntimePrompt,
  type PeaRuntimePrompt,
  type PeaRuntimePromptPart,
} from "../pea-runtime-prompts.js";
import {
  PeaRuntimeProtocolSessions,
  type PeaRuntimeProtocolSessionInfo,
} from "../pea-runtime-protocol-sessions.js";
import { describePeaRuntimeProtocolStatus } from "../pea-runtime-protocol-status.js";
import { defaultPeaRuntimeSessionRegistryPath } from "../pea-runtime-session-registry.js";
import { sanitizeJson } from "../pea-runtime-events.js";
import type { PeaRuntimeResource } from "../pea-runtime-resources.js";
import { PeaRuntimeToAgUiEvents } from "./pea-runtime-to-agui-events.js";

export type PeaAgUiRuntimeId = "pea" | "dev-agent";

export interface PeaAgUiAgentOptions {
  runtime: PeaAgUiRuntimeId;
  port?: number;
  token?: string;
  hostBaseUrl?: string;
  workspaceKey?: string;
  workspaceRoot?: string;
  modelId?: string;
  allowOauthBetaAuth?: boolean;
  authSource?: PeaAgentOptions["authSource"];
  runtimeOverride?: PeaAgUiRuntime;
  runtimeSessions?: PeaRuntimeProtocolSessions;
  sessionRegistryPath?: string | null;
  runtimeAuthPath?: string;
}

export interface PeaAgUiServerInfo {
  runUrl: string;
  statusUrl: string;
  sessionsUrl: string;
  eventsUrl: string;
  logoutUrl: string;
  token: string;
  port: number;
}

type PeaAgUiRuntime = PeaRuntime | DevAgentRuntime;

const defaultPort = 43112;
const loopbackHost = "127.0.0.1";

export class PeaAgUiAgent {
  private readonly runtimeSessions: PeaRuntimeProtocolSessions;

  constructor(private readonly options: PeaAgUiAgentOptions) {
    this.runtimeSessions =
      options.runtimeSessions ??
      new PeaRuntimeProtocolSessions({
        ...options,
        idPrefix: "pea-agui",
        defaultCwd: options.workspaceRoot ?? process.cwd(),
        sessionRegistryPath: agUiSessionRegistryPath(options),
        factory: options.runtimeOverride
          ? {
              runtimeId: options.runtime,
              create: async () => options.runtimeOverride!,
            }
          : undefined,
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

    const translator = new PeaRuntimeToAgUiEvents();
    const interrupts = new PeaRuntimeInterruptCollector();
    let nextSequence = nextAgUiEventSequence(this.runtimeSessions.history(session.id));
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

    try {
      const stopReason = await this.runtimeSessions.sendPrompt(session.id, agUiPrompt(parsed));
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

  sessions(): PeaRuntimeProtocolSessionInfo[] {
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
      .flatMap((entry): BaseEvent[] => (isAgUiEvent(entry.payload) ? [entry.payload] : []))
      .filter((event) => agUiEventSequence(event) > (request.afterSequence ?? 0));
  }

  capabilities(): AgentCapabilities {
    return agUiCapabilities({
      runtimeId: this.options.runtime,
      authSource: this.options.authSource,
      allowOauthBetaAuth: this.options.allowOauthBetaAuth,
    });
  }

  async logout(): Promise<void> {
    await logoutPeaRuntimeAuth({
      runtimeId: this.options.runtime,
      authSource: this.options.authSource,
      allowOauthBetaAuth: this.options.allowOauthBetaAuth,
      mastraAuthPath: this.options.runtimeAuthPath,
    });
  }

  async close(): Promise<void> {
    this.runtimeSessions.closeAll();
  }

  private sessionForThread(threadId: string): PeaRuntimeProtocolSessionInfo | undefined {
    return this.sessions().find((candidate) => candidate.externalThreadId === threadId);
  }
}

function agUiSessionRegistryPath(options: PeaAgUiAgentOptions): string | null | undefined {
  if (options.runtimeSessions || options.runtimeOverride) return undefined;
  if (options.sessionRegistryPath === null) return null;
  return (
    options.sessionRegistryPath ??
    defaultPeaRuntimeSessionRegistryPath({ runtimeId: options.runtime, protocol: "ag-ui" })
  );
}

export class PeaAgUiHttpAgent {
  private readonly auth: PeaLocalTransportAuth;
  private server: ReturnType<typeof createServer> | null = null;
  private agent: PeaAgUiAgent;

  constructor(private readonly options: PeaAgUiAgentOptions) {
    this.auth = createPeaLocalTransportAuth({
      token: options.token,
      headerNames: ["x-pea-local-token", "x-pea-agui-token"],
    });
    this.agent = new PeaAgUiAgent(options);
  }

  async start(): Promise<PeaAgUiServerInfo> {
    const port = this.options.port ?? defaultPort;
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
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
          describePeaRuntimeProtocolStatus({
            runtimeId: this.options.runtime,
            protocol: "ag-ui",
            transport: "http+sse",
            authSource: this.options.authSource,
            allowOauthBetaAuth: this.options.allowOauthBetaAuth,
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

    const sessionCloseMatch = /^\/agui\/sessions\/([^/]+)\/close$/.exec(url.pathname);
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
            afterSequence: parseOptionalSequence(url.searchParams.get("afterSequence")),
          }),
        }),
      );
      return;
    }

    if (url.pathname === "/agui/logout" && request.method === "POST") {
      const logoutSupported = this.agent.capabilities().custom?.["pea.logoutSupported"] === true;
      if (!logoutSupported) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Logout is not supported for this runtime." }));
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
      await this.agent.run(input, (event) => response.write(`data: ${JSON.stringify(event)}\n\n`));
      response.end();
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  }

  private startInfo(port: number): PeaAgUiServerInfo {
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

function agUiPrompt(input: RunAgentInput): PeaRuntimePrompt {
  const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
  const lastUserMessage =
    lastUserMessageIndex >= 0 ? input.messages[lastUserMessageIndex] : undefined;
  const priorMessages =
    lastUserMessageIndex >= 0
      ? input.messages.filter((_, index) => index !== lastUserMessageIndex)
      : input.messages;
  const parts: PeaRuntimePromptPart[] = [
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
  const forwardedProps = stripPeaAgUiForwardedProps(input.forwardedProps);
  if (isMeaningfulJson(forwardedProps)) {
    parts.push({
      contextDescription: "AG-UI forwarded properties supplied by the client",
      contextValue: forwardedProps,
    });
  }

  return {
    ...createPeaRuntimePrompt(parts),
    resumeDecisions: toPeaRuntimeResumeDecisions(input.resume),
  };
}

interface PeaAgUiRuntimeScope {
  cwd: string;
  additionalDirectories: string[];
}

function agUiRuntimeScope(input: RunAgentInput, defaultCwd: string): PeaAgUiRuntimeScope {
  const forwardedProps = isRecord(input.forwardedProps) ? input.forwardedProps : {};
  const peaProps = isRecord(forwardedProps.pea) ? forwardedProps.pea : {};
  return {
    cwd: firstString(peaProps.cwd, forwardedProps.cwd) ?? defaultCwd,
    additionalDirectories: stringArray(
      peaProps.additionalDirectories ?? forwardedProps.additionalDirectories,
    ),
  };
}

function defaultAgUiCwd(options: PeaAgUiAgentOptions): string {
  return options.workspaceRoot ?? options.runtimeOverride?.workspace?.cwd ?? process.cwd();
}

function stripPeaAgUiForwardedProps(forwardedProps: unknown): unknown {
  if (!isRecord(forwardedProps)) return forwardedProps;
  const stripped = { ...forwardedProps };
  delete stripped.pea;
  delete stripped.cwd;
  delete stripped.additionalDirectories;
  return stripped;
}

function messagePromptParts(message: Message | undefined): PeaRuntimePromptPart[] {
  if (!message) return [];
  const content = (message as { content?: unknown }).content;
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
  const content = (message as { content?: unknown }).content;
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

function agUiInputResource(messageId: string, index: number, part: unknown): PeaRuntimeResource {
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
  return context.map((entry) => ({ value: entry.value, description: entry.description }));
}

function agUiCapabilities(options: {
  runtimeId: PeaAgUiRuntimeId;
  authSource?: PeaAgentOptions["authSource"];
  allowOauthBetaAuth?: boolean;
}): AgentCapabilities {
  const descriptor = describePeaRuntime(options.runtimeId);
  const auth = describePeaRuntimeAuth({
    runtimeId: options.runtimeId,
    authSource: options.authSource,
    allowOauthBetaAuth: options.allowOauthBetaAuth,
  });
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
      "pea.runtime": options.runtimeId,
      "pea.sessionModel": "active-thread",
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
    "content-type, authorization, x-pea-local-token, x-pea-agui-token",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  response.writeHead(500, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
}

function parseOptionalSequence(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nextAgUiEventSequence(history: ReturnType<PeaRuntimeProtocolSessions["history"]>): number {
  const sequences = history
    .filter(isAgUiProtocolHistoryEntry)
    .map((entry) => agUiEventSequence(entry.payload));
  return Math.max(0, ...sequences) + 1;
}

function isAgUiProtocolHistoryEntry(
  entry: ReturnType<PeaRuntimeProtocolSessions["history"]>[number],
): entry is Extract<
  ReturnType<PeaRuntimeProtocolSessions["history"]>[number],
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
  return error instanceof Error && error.message.startsWith("Unknown Pea runtime session:");
}

function agUiEventSequence(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const sequence = (value as { sequence?: unknown }).sequence;
  return typeof sequence === "number" && Number.isFinite(sequence) ? sequence : 0;
}

function isMeaningfulJson(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const sanitized = sanitizeJson(value);
  if (Array.isArray(sanitized)) return sanitized.length > 0;
  if (typeof sanitized === "object" && sanitized !== null) return Object.keys(sanitized).length > 0;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}
