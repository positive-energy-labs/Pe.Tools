import path from "node:path";
import type { RuntimeContextEntry } from "../context.ts";
import {
  sanitizeJson,
  type RuntimeEvent,
  type RuntimeJsonValue,
  type RuntimeProtocol,
} from "../events.ts";
import { createRuntimeResumeContextEntries, type RuntimeResumeDecision } from "../interrupts.ts";
import {
  createRuntimeResourceContextEntries,
  createRuntimeResourceScope,
  type RuntimeResource,
} from "../resources.ts";
import type { RuntimeFactory, RuntimeHandle } from "../runtime.ts";
import {
  createRuntimeSessionRegistry,
  type RuntimeSessionHistoryEntry,
  type RuntimeSessionRecord,
  type RuntimeSessionRegistry,
} from "./session-registry.ts";

export interface RuntimeProtocolSession {
  id: string;
  protocol: RuntimeProtocol;
  cwd: string;
  additionalDirectories: string[];
  title: string;
  runtime: RuntimeHandle;
  threadId: string;
  resourceId: string;
  externalThreadId?: string;
  createdAt: string;
  updatedAt: string;
  cancelled: boolean;
  promptActive: boolean;
  pendingResumeDecisions: RuntimeResumeDecision[];
  restoredFromRegistry: boolean;
  emitQueue: Promise<void>;
  unsubscribe: () => void;
}

export interface RuntimeProtocolSessionsOptions {
  factory: RuntimeFactory;
  idPrefix?: string;
  defaultCwd?: string;
  sessionRegistry?: RuntimeSessionRegistry;
  sessionRegistryPath?: string | null;
}

export interface RuntimeCreateProtocolSessionRequest {
  protocol: RuntimeProtocol;
  cwd?: string;
  additionalDirectories?: string[];
  title?: string;
  externalThreadId?: string;
}

export interface RuntimeSendProtocolPromptRequest {
  content: string;
  context?: RuntimeContextEntry[];
  resources?: RuntimeResource[];
  resumeDecisions?: RuntimeResumeDecision[];
}

export interface RuntimeProtocolSessionInfo {
  id: string;
  protocol: RuntimeProtocol;
  cwd: string;
  additionalDirectories: string[];
  title: string;
  threadId: string;
  resourceId: string;
  externalThreadId?: string;
  createdAt: string;
  updatedAt: string;
  promptActive: boolean;
}

export class RuntimeProtocolSessions {
  private readonly factory: RuntimeFactory;
  private readonly idPrefix: string;
  private readonly registry?: RuntimeSessionRegistry;
  private readonly sessions = new Map<string, RuntimeProtocolSession>();
  private readonly externalThreadIndex = new Map<string, string>();
  private readonly inMemoryHistory = new Map<string, RuntimeSessionHistoryEntry[]>();
  private readonly inMemoryRecords = new Map<string, RuntimeSessionRecord>();
  private nextSessionNumber = 1;

  constructor(private readonly options: RuntimeProtocolSessionsOptions) {
    this.factory = options.factory;
    this.idPrefix = options.idPrefix ?? `${this.factory.descriptor.id}-session`;
    this.registry =
      options.sessionRegistry ?? createRuntimeSessionRegistry(options.sessionRegistryPath);
    this.nextSessionNumber = nextSessionNumber(this.idPrefix, this.registry?.list());
  }

  async createSession(
    request: RuntimeCreateProtocolSessionRequest,
  ): Promise<RuntimeProtocolSession> {
    const id = this.nextId();
    const cwd = normalizeCwd(request.cwd ?? this.options.defaultCwd ?? process.cwd());
    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    const title = request.title ?? `${request.protocol} ${id}`;
    const runtime = await this.factory.create({
      cwd,
      workspaceRoot: cwd,
      additionalDirectories,
      protocol: request.protocol,
    });
    const runtimeSession = await runtime.sessions.createThreadSession({
      title,
    });
    const now = new Date().toISOString();

    const session: RuntimeProtocolSession = {
      id,
      protocol: request.protocol,
      cwd: runtime.workspace?.cwd ?? cwd,
      additionalDirectories,
      title,
      runtime,
      threadId: runtimeSession.threadId,
      resourceId: runtimeSession.resourceId,
      externalThreadId: request.externalThreadId,
      createdAt: now,
      updatedAt: now,
      cancelled: false,
      promptActive: false,
      pendingResumeDecisions: [],
      restoredFromRegistry: false,
      emitQueue: Promise.resolve(),
      unsubscribe: () => undefined,
    };

    this.sessions.set(session.id, session);
    if (request.externalThreadId) {
      this.externalThreadIndex.set(
        externalThreadKey(request.protocol, request.externalThreadId),
        id,
      );
    }
    this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
    return session;
  }

  async forkSession(
    sourceId: string,
    request: {
      cwd: string;
      additionalDirectories?: string[];
      title?: string;
      protocol?: RuntimeProtocol;
    },
  ): Promise<RuntimeProtocolSession> {
    const source = this.sourceSessionRecord(sourceId);
    if (request.protocol && source.protocol !== request.protocol) {
      throw new Error(
        `Runtime session ${sourceId} belongs to protocol '${source.protocol}' and cannot fork as '${request.protocol}'.`,
      );
    }
    const cwd = normalizeCwd(request.cwd);
    if (normalizeCwd(source.cwd) !== cwd) {
      throw new Error(
        `Runtime session ${sourceId} was created for cwd '${source.cwd}' and cannot fork with cwd '${request.cwd}'.`,
      );
    }

    const sourceHistory = this.history(sourceId);
    const session = await this.createSession({
      protocol: source.protocol,
      cwd,
      additionalDirectories: request.additionalDirectories,
      title: request.title ?? `${source.title} fork`,
    });
    if (sourceHistory.length > 0) {
      if (this.registry) this.registry.replaceHistory(session.id, sourceHistory);
      else this.inMemoryHistory.set(session.id, [...sourceHistory]);
      session.restoredFromRegistry = true;
    }
    this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
    return session;
  }

  async getOrCreateThreadSession(
    request: RuntimeCreateProtocolSessionRequest & {
      externalThreadId: string;
    },
  ): Promise<RuntimeProtocolSession> {
    const existingId = this.externalThreadIndex.get(
      externalThreadKey(request.protocol, request.externalThreadId),
    );
    if (existingId) {
      const existing = this.getSession(existingId);
      return this.resumeSession(existingId, {
        ...request,
        additionalDirectories: request.additionalDirectories ?? existing.additionalDirectories,
      });
    }
    const record = this.registry
      ?.list({
        runtimeId: this.factory.descriptor.id,
        protocol: request.protocol,
        externalThreadId: request.externalThreadId,
      })
      .at(0);
    if (record) {
      return this.resumeSession(record.id, {
        ...request,
        additionalDirectories: request.additionalDirectories ?? record.additionalDirectories,
      });
    }
    return this.createSession(request);
  }

  getSession(id: string): RuntimeProtocolSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown Runtime session: ${id}`);
    return session;
  }

  async resumeSession(
    id: string,
    request: {
      cwd?: string;
      additionalDirectories?: string[];
      protocol?: RuntimeProtocol;
    } = {},
  ): Promise<RuntimeProtocolSession> {
    const session = this.sessions.get(id);
    if (!session) return this.rehydrateSession(id, request);
    if (request.protocol && session.protocol !== request.protocol) {
      throw new Error(
        `Runtime session ${id} belongs to protocol '${session.protocol}' and cannot resume as '${request.protocol}'.`,
      );
    }

    const cwd = normalizeCwd(request.cwd ?? session.cwd);
    if (normalizeCwd(session.cwd) !== cwd) {
      throw new Error(
        `Runtime session ${id} was created for cwd '${session.cwd}' and cannot resume with cwd '${request.cwd}'.`,
      );
    }

    session.additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    session.updatedAt = new Date().toISOString();
    this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
    return session;
  }

  listSessions(
    filter: { cwd?: string | null; protocol?: RuntimeProtocol } = {},
  ): RuntimeProtocolSessionInfo[] {
    const cwd = filter.cwd ? normalizeCwd(filter.cwd) : undefined;
    const active = Array.from(this.sessions.values())
      .filter((session) => !filter.protocol || session.protocol === filter.protocol)
      .filter((session) => !cwd || normalizeCwd(session.cwd) === cwd)
      .map(sessionInfo);
    const activeIds = new Set(active.map((session) => session.id));
    const inMemory =
      this.registry == null
        ? Array.from(this.inMemoryRecords.values())
            .filter((record) => !activeIds.has(record.id))
            .filter((record) => record.runtimeId === this.factory.descriptor.id)
            .filter((record) => !filter.protocol || record.protocol === filter.protocol)
            .filter((record) => !cwd || normalizeCwd(record.cwd) === cwd)
            .map(recordInfo)
        : [];
    const persisted =
      this.registry
        ?.list({
          runtimeId: this.factory.descriptor.id,
          protocol: filter.protocol,
          cwd,
        })
        .filter((record) => !activeIds.has(record.id))
        .map(recordInfo) ?? [];
    return [...active, ...inMemory, ...persisted].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  subscribe(id: string, listener: (event: RuntimeEvent) => void | Promise<void>): () => void {
    const session = this.getSession(id);
    return session.runtime.sessions.subscribe(listener);
  }

  enqueue(id: string, action: () => Promise<void> | void): void {
    const session = this.getSession(id);
    session.emitQueue = session.emitQueue.then(action).catch(() => undefined);
  }

  recordProtocolEvent(id: string, protocol: RuntimeProtocol, payload: unknown): void {
    this.appendHistory(id, {
      type: "protocol_event",
      protocol,
      payload: sanitizeHistoryPayload(payload),
      createdAt: new Date().toISOString(),
    });
  }

  history(id: string): RuntimeSessionHistoryEntry[] {
    return this.registry?.history(id) ?? [...(this.inMemoryHistory.get(id) ?? [])];
  }

  recordResumeDecision(id: string, decision: RuntimeResumeDecision): void {
    const session = this.getSession(id);
    session.pendingResumeDecisions = [...session.pendingResumeDecisions, decision];
    session.updatedAt = new Date().toISOString();
    this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
  }

  async sendPrompt(
    id: string,
    request: RuntimeSendProtocolPromptRequest,
  ): Promise<"end_turn" | "cancelled"> {
    const session = this.getSession(id);
    if (session.promptActive)
      throw new Error(`Runtime session ${id} already has an active prompt.`);

    session.cancelled = false;
    session.promptActive = true;
    session.updatedAt = new Date().toISOString();
    const previousHistory = session.restoredFromRegistry ? this.history(id) : [];
    this.appendHistory(id, {
      type: "prompt",
      content: request.content,
      createdAt: session.updatedAt,
    });
    const consumedResumeDecisions = session.pendingResumeDecisions;
    const resumeDecisions = mergeResumeDecisions(consumedResumeDecisions, request.resumeDecisions);
    session.pendingResumeDecisions = [];
    this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
    try {
      await session.runtime.sessions.switchThread({
        threadId: session.threadId,
      });
      await session.runtime.sessions.sendMessage({
        content: request.content,
        context: createPromptContext(session, { ...request, resumeDecisions }, previousHistory),
        ...(resumeDecisions ? { resumeDecisions } : {}),
        protocol: session.protocol,
        protocolSessionId: session.id,
      });
      await session.emitQueue;
      return session.cancelled ? "cancelled" : "end_turn";
    } catch (error) {
      session.pendingResumeDecisions = [
        ...consumedResumeDecisions,
        ...session.pendingResumeDecisions,
      ];
      throw error;
    } finally {
      session.promptActive = false;
      session.updatedAt = new Date().toISOString();
      session.restoredFromRegistry = false;
      this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
    }
  }

  cancel(id: string): void {
    const session = this.getSession(id);
    session.cancelled = true;
    session.updatedAt = new Date().toISOString();
    session.runtime.sessions.abort();
    this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
  }

  async close(id: string): Promise<void> {
    const session = this.getSession(id);
    session.cancelled = true;
    session.runtime.sessions.abort();
    session.unsubscribe();
    this.sessions.delete(id);
    if (session.externalThreadId) {
      this.externalThreadIndex.delete(
        externalThreadKey(session.protocol, session.externalThreadId),
      );
    }
    session.updatedAt = new Date().toISOString();
    const record = sessionRecord(session, this.factory.descriptor.id);
    if (this.registry) this.registry.upsert(record);
    else this.inMemoryRecords.set(record.id, record);
    await session.runtime.close?.();
  }

  async closeAll(): Promise<void> {
    for (const sessionId of Array.from(this.sessions.keys())) await this.close(sessionId);
  }

  async delete(id: string): Promise<void> {
    if (this.sessions.has(id)) await this.close(id);
    this.registry?.delete(id);
    this.inMemoryRecords.delete(id);
    this.inMemoryHistory.delete(id);
  }

  private nextId(): string {
    return `${this.idPrefix}-${this.nextSessionNumber++}`;
  }

  private sourceSessionRecord(id: string): RuntimeSessionRecord {
    const session = this.sessions.get(id);
    if (session) return sessionRecord(session, this.factory.descriptor.id);

    const record = this.registry?.get(id);
    const inMemoryRecord = this.inMemoryRecords.get(id);
    const source = record ?? inMemoryRecord;
    if (!source || source.runtimeId !== this.factory.descriptor.id) {
      throw new Error(`Unknown Runtime session: ${id}`);
    }
    return source;
  }

  private async rehydrateSession(
    id: string,
    request: {
      cwd?: string;
      additionalDirectories?: string[];
      protocol?: RuntimeProtocol;
    },
  ): Promise<RuntimeProtocolSession> {
    const record = this.registry?.get(id) ?? this.inMemoryRecords.get(id);
    if (!record || record.runtimeId !== this.factory.descriptor.id) {
      throw new Error(`Unknown Runtime session: ${id}`);
    }
    if (request.protocol && record.protocol !== request.protocol) {
      throw new Error(
        `Runtime session ${id} belongs to protocol '${record.protocol}' and cannot resume as '${request.protocol}'.`,
      );
    }

    const cwd = normalizeCwd(request.cwd ?? record.cwd);
    if (normalizeCwd(record.cwd) !== cwd) {
      throw new Error(
        `Runtime session ${id} was created for cwd '${record.cwd}' and cannot resume with cwd '${request.cwd}'.`,
      );
    }

    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? record.additionalDirectories,
    );
    const runtime = await this.factory.create({
      cwd,
      workspaceRoot: cwd,
      additionalDirectories,
      protocol: record.protocol,
    });
    const runtimeSession = await runtime.sessions.createThreadSession({
      title: record.title,
    });
    const now = new Date().toISOString();
    const session: RuntimeProtocolSession = {
      id: record.id,
      protocol: record.protocol,
      cwd: runtime.workspace?.cwd ?? cwd,
      additionalDirectories,
      title: record.title,
      runtime,
      threadId: runtimeSession.threadId,
      resourceId: runtimeSession.resourceId,
      externalThreadId: record.externalThreadId,
      createdAt: record.createdAt,
      updatedAt: now,
      cancelled: false,
      promptActive: false,
      pendingResumeDecisions: record.pendingResumeDecisions ?? [],
      restoredFromRegistry: true,
      emitQueue: Promise.resolve(),
      unsubscribe: () => undefined,
    };

    this.sessions.set(session.id, session);
    this.inMemoryRecords.delete(session.id);
    if (session.externalThreadId) {
      this.externalThreadIndex.set(
        externalThreadKey(session.protocol, session.externalThreadId),
        session.id,
      );
    }
    this.registry?.upsert(sessionRecord(session, this.factory.descriptor.id));
    return session;
  }

  private appendHistory(id: string, entry: RuntimeSessionHistoryEntry): void {
    if (this.registry) {
      this.registry.appendHistory(id, entry);
      return;
    }

    this.inMemoryHistory.set(id, [...(this.inMemoryHistory.get(id) ?? []), entry]);
  }
}

function createPromptContext(
  session: RuntimeProtocolSession,
  request: RuntimeSendProtocolPromptRequest,
  restoredHistory: RuntimeSessionHistoryEntry[] = [],
): RuntimeContextEntry[] | undefined {
  const resourceEntries = createRuntimeResourceContextEntries({
    scope: createRuntimeResourceScope({
      cwd: session.cwd,
      additionalDirectories: session.additionalDirectories,
    }),
    resources: request.resources,
  });
  const restoredHistoryEntries =
    restoredHistory.length > 0
      ? [
          {
            description: "Restored protocol session history",
            value: JSON.stringify(restoredHistory, null, 2),
          },
        ]
      : [];
  const resumeEntries = createRuntimeResumeContextEntries(request.resumeDecisions);
  const context = [
    ...(request.context ?? []),
    ...resourceEntries,
    ...resumeEntries,
    ...restoredHistoryEntries,
  ];
  return context.length > 0 ? context : undefined;
}

export function sessionInfo(session: RuntimeProtocolSession): RuntimeProtocolSessionInfo {
  return {
    id: session.id,
    protocol: session.protocol,
    cwd: session.cwd,
    additionalDirectories: session.additionalDirectories,
    title: session.title,
    threadId: session.threadId,
    resourceId: session.resourceId,
    ...(session.externalThreadId ? { externalThreadId: session.externalThreadId } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    promptActive: session.promptActive,
  };
}

function recordInfo(record: RuntimeSessionRecord): RuntimeProtocolSessionInfo {
  return {
    id: record.id,
    protocol: record.protocol,
    cwd: record.cwd,
    additionalDirectories: record.additionalDirectories,
    title: record.title,
    threadId: record.threadId ?? "",
    resourceId: record.resourceId ?? "",
    ...(record.externalThreadId ? { externalThreadId: record.externalThreadId } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    promptActive: false,
  };
}

function sessionRecord(session: RuntimeProtocolSession, runtimeId: string): RuntimeSessionRecord {
  return {
    id: session.id,
    runtimeId,
    protocol: session.protocol,
    cwd: normalizeCwd(session.cwd),
    additionalDirectories: normalizeAdditionalDirectories(session.additionalDirectories),
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    threadId: session.threadId,
    resourceId: session.resourceId,
    externalThreadId: session.externalThreadId,
    ...(session.pendingResumeDecisions.length > 0
      ? { pendingResumeDecisions: session.pendingResumeDecisions }
      : {}),
  };
}

function normalizeCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  if (!path.isAbsolute(resolved)) throw new Error(`Runtime cwd must be absolute: ${cwd}`);
  return resolved;
}

function normalizeAdditionalDirectories(additionalDirectories: string[]): string[] {
  return Array.from(
    new Set(
      additionalDirectories.map((directory) => {
        const resolved = path.resolve(directory);
        if (!path.isAbsolute(resolved))
          throw new Error(`Runtime additional directory must be absolute: ${directory}`);
        return resolved;
      }),
    ),
  );
}

function externalThreadKey(protocol: RuntimeProtocol, externalThreadId: string): string {
  return `${protocol}:${externalThreadId}`;
}

function nextSessionNumber(idPrefix: string, records: RuntimeSessionRecord[] | undefined): number {
  if (!records || records.length === 0) return 1;
  let max = 0;
  for (const record of records) {
    const match = new RegExp(`^${escapeRegExp(idPrefix)}-(\\d+)$`).exec(record.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeHistoryPayload(payload: unknown): RuntimeJsonValue {
  return sanitizeJson(payload);
}

function mergeResumeDecisions(
  pending: RuntimeResumeDecision[],
  supplied: RuntimeResumeDecision[] | undefined,
): RuntimeResumeDecision[] | undefined {
  const merged = [...pending, ...(supplied ?? [])];
  return merged.length > 0 ? merged : undefined;
}
