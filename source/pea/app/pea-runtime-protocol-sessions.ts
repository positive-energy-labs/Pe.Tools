import path from "node:path";
import {
  createPeaRuntimeFactory,
  type PeaAnyRuntime,
  type PeaRuntimeFactory,
  type PeaRuntimeFactoryOptions,
} from "./pea-runtime-factory.js";
import type { PeaRuntimeContextEntry } from "./pea-runtime-context.js";
import {
  sanitizeJson,
  type PeaJsonValue,
  type PeaRuntimeEvent,
  type PeaRuntimeProtocol,
} from "./pea-runtime-events.js";
import {
  createPeaRuntimeResourceContextEntries,
  createPeaRuntimeResourceScope,
  type PeaRuntimeResource,
} from "./pea-runtime-resources.js";
import {
  createPeaRuntimeSessionRegistry,
  type PeaRuntimeSessionHistoryEntry,
  type PeaRuntimeSessionRecord,
  type PeaRuntimeSessionRegistry,
} from "./pea-runtime-session-registry.js";
import {
  createPeaRuntimeResumeContextEntries,
  type PeaRuntimeResumeDecision,
} from "./pea-runtime-interrupts.js";

export interface PeaRuntimeProtocolSession {
  id: string;
  protocol: PeaRuntimeProtocol;
  cwd: string;
  additionalDirectories: string[];
  title: string;
  runtime: PeaAnyRuntime;
  threadId: string;
  resourceId: string;
  externalThreadId?: string;
  createdAt: string;
  updatedAt: string;
  cancelled: boolean;
  promptActive: boolean;
  pendingResumeDecisions: PeaRuntimeResumeDecision[];
  restoredFromRegistry: boolean;
  emitQueue: Promise<void>;
  unsubscribe: () => void;
}

export interface PeaRuntimeProtocolSessionsOptions extends PeaRuntimeFactoryOptions {
  factory?: PeaRuntimeFactory;
  idPrefix?: string;
  defaultCwd?: string;
  sessionRegistry?: PeaRuntimeSessionRegistry;
  sessionRegistryPath?: string | null;
}

export interface PeaRuntimeCreateProtocolSessionRequest {
  protocol: PeaRuntimeProtocol;
  cwd?: string;
  additionalDirectories?: string[];
  title?: string;
  externalThreadId?: string;
}

export interface PeaRuntimeSendProtocolPromptRequest {
  content: string;
  context?: PeaRuntimeContextEntry[];
  resources?: PeaRuntimeResource[];
  resumeDecisions?: PeaRuntimeResumeDecision[];
}

export interface PeaRuntimeProtocolSessionInfo {
  id: string;
  protocol: PeaRuntimeProtocol;
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

export class PeaRuntimeProtocolSessions {
  private readonly factory: PeaRuntimeFactory;
  private readonly idPrefix: string;
  private readonly registry?: PeaRuntimeSessionRegistry;
  private readonly sessions = new Map<string, PeaRuntimeProtocolSession>();
  private readonly externalThreadIndex = new Map<string, string>();
  private readonly inMemoryHistory = new Map<string, PeaRuntimeSessionHistoryEntry[]>();
  private readonly inMemoryRecords = new Map<string, PeaRuntimeSessionRecord>();
  private nextSessionNumber = 1;

  constructor(private readonly options: PeaRuntimeProtocolSessionsOptions) {
    this.factory = options.factory ?? createPeaRuntimeFactory(options);
    this.idPrefix = options.idPrefix ?? `${options.runtime}-session`;
    this.registry =
      options.sessionRegistry ?? createPeaRuntimeSessionRegistry(options.sessionRegistryPath);
    this.nextSessionNumber = nextSessionNumber(this.idPrefix, this.registry?.list());
  }

  async createSession(
    request: PeaRuntimeCreateProtocolSessionRequest,
  ): Promise<PeaRuntimeProtocolSession> {
    const id = this.nextId();
    const cwd = normalizeCwd(request.cwd ?? this.options.defaultCwd ?? process.cwd());
    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    const title = request.title ?? `${request.protocol} ${id}`;
    const runtime = await this.factory.create({ cwd, protocol: request.protocol });
    const runtimeSession = await runtime.sessions.createThreadSession({ title });
    const now = new Date().toISOString();

    const session: PeaRuntimeProtocolSession = {
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
    this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
    return session;
  }

  async forkSession(
    sourceId: string,
    request: {
      cwd: string;
      additionalDirectories?: string[];
      title?: string;
      protocol?: PeaRuntimeProtocol;
    },
  ): Promise<PeaRuntimeProtocolSession> {
    const source = this.sourceSessionRecord(sourceId);
    if (request.protocol && source.protocol !== request.protocol) {
      throw new Error(
        `Pea runtime session ${sourceId} belongs to protocol '${source.protocol}' and cannot fork as '${request.protocol}'.`,
      );
    }
    const cwd = normalizeCwd(request.cwd);
    if (normalizeCwd(source.cwd) !== cwd) {
      throw new Error(
        `Pea runtime session ${sourceId} was created for cwd '${source.cwd}' and cannot fork with cwd '${request.cwd}'.`,
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
    this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
    return session;
  }

  async getOrCreateThreadSession(
    request: PeaRuntimeCreateProtocolSessionRequest & { externalThreadId: string },
  ): Promise<PeaRuntimeProtocolSession> {
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
        runtimeId: this.factory.runtimeId,
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

  getSession(id: string): PeaRuntimeProtocolSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown Pea runtime session: ${id}`);
    return session;
  }

  async resumeSession(
    id: string,
    request: { cwd?: string; additionalDirectories?: string[]; protocol?: PeaRuntimeProtocol } = {},
  ): Promise<PeaRuntimeProtocolSession> {
    const session = this.sessions.get(id);
    if (!session) return this.rehydrateSession(id, request);
    if (request.protocol && session.protocol !== request.protocol) {
      throw new Error(
        `Pea runtime session ${id} belongs to protocol '${session.protocol}' and cannot resume as '${request.protocol}'.`,
      );
    }

    const cwd = normalizeCwd(request.cwd ?? session.cwd);
    if (normalizeCwd(session.cwd) !== cwd) {
      throw new Error(
        `Pea runtime session ${id} was created for cwd '${session.cwd}' and cannot resume with cwd '${request.cwd}'.`,
      );
    }

    session.additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    session.updatedAt = new Date().toISOString();
    this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
    return session;
  }

  listSessions(
    filter: { cwd?: string | null; protocol?: PeaRuntimeProtocol } = {},
  ): PeaRuntimeProtocolSessionInfo[] {
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
            .filter((record) => record.runtimeId === this.factory.runtimeId)
            .filter((record) => !filter.protocol || record.protocol === filter.protocol)
            .filter((record) => !cwd || normalizeCwd(record.cwd) === cwd)
            .map(recordInfo)
        : [];
    const persisted =
      this.registry
        ?.list({ runtimeId: this.factory.runtimeId, protocol: filter.protocol, cwd })
        .filter((record) => !activeIds.has(record.id))
        .map(recordInfo) ?? [];
    return [...active, ...inMemory, ...persisted].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  subscribe(id: string, listener: (event: PeaRuntimeEvent) => void | Promise<void>): () => void {
    const session = this.getSession(id);
    return session.runtime.sessions.subscribe(listener);
  }

  enqueue(id: string, action: () => Promise<void> | void): void {
    const session = this.getSession(id);
    session.emitQueue = session.emitQueue.then(action).catch(() => undefined);
  }

  recordProtocolEvent(id: string, protocol: PeaRuntimeProtocol, payload: unknown): void {
    this.appendHistory(id, {
      type: "protocol_event",
      protocol,
      payload: sanitizeHistoryPayload(payload),
      createdAt: new Date().toISOString(),
    });
  }

  history(id: string): PeaRuntimeSessionHistoryEntry[] {
    return this.registry?.history(id) ?? [...(this.inMemoryHistory.get(id) ?? [])];
  }

  recordResumeDecision(id: string, decision: PeaRuntimeResumeDecision): void {
    const session = this.getSession(id);
    session.pendingResumeDecisions = [...session.pendingResumeDecisions, decision];
    session.updatedAt = new Date().toISOString();
    this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
  }

  async sendPrompt(
    id: string,
    request: PeaRuntimeSendProtocolPromptRequest,
  ): Promise<"end_turn" | "cancelled"> {
    const session = this.getSession(id);
    if (session.promptActive)
      throw new Error(`Pea runtime session ${id} already has an active prompt.`);

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
    this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
    try {
      await session.runtime.sessions.switchThread({ threadId: session.threadId });
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
      this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
    }
  }

  cancel(id: string): void {
    const session = this.getSession(id);
    session.cancelled = true;
    session.updatedAt = new Date().toISOString();
    session.runtime.sessions.abort();
    this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
  }

  close(id: string): void {
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
    const record = sessionRecord(session, this.factory.runtimeId);
    if (this.registry) this.registry.upsert(record);
    else this.inMemoryRecords.set(record.id, record);
  }

  closeAll(): void {
    for (const sessionId of Array.from(this.sessions.keys())) this.close(sessionId);
  }

  delete(id: string): void {
    if (this.sessions.has(id)) this.close(id);
    this.registry?.delete(id);
    this.inMemoryRecords.delete(id);
    this.inMemoryHistory.delete(id);
  }

  private nextId(): string {
    return `${this.idPrefix}-${this.nextSessionNumber++}`;
  }

  private sourceSessionRecord(id: string): PeaRuntimeSessionRecord {
    const session = this.sessions.get(id);
    if (session) return sessionRecord(session, this.factory.runtimeId);

    const record = this.registry?.get(id);
    const inMemoryRecord = this.inMemoryRecords.get(id);
    const source = record ?? inMemoryRecord;
    if (!source || source.runtimeId !== this.factory.runtimeId) {
      throw new Error(`Unknown Pea runtime session: ${id}`);
    }
    return source;
  }

  private async rehydrateSession(
    id: string,
    request: { cwd?: string; additionalDirectories?: string[]; protocol?: PeaRuntimeProtocol },
  ): Promise<PeaRuntimeProtocolSession> {
    const record = this.registry?.get(id) ?? this.inMemoryRecords.get(id);
    if (!record || record.runtimeId !== this.factory.runtimeId) {
      throw new Error(`Unknown Pea runtime session: ${id}`);
    }
    if (request.protocol && record.protocol !== request.protocol) {
      throw new Error(
        `Pea runtime session ${id} belongs to protocol '${record.protocol}' and cannot resume as '${request.protocol}'.`,
      );
    }

    const cwd = normalizeCwd(request.cwd ?? record.cwd);
    if (normalizeCwd(record.cwd) !== cwd) {
      throw new Error(
        `Pea runtime session ${id} was created for cwd '${record.cwd}' and cannot resume with cwd '${request.cwd}'.`,
      );
    }

    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? record.additionalDirectories,
    );
    const runtime = await this.factory.create({ cwd, protocol: record.protocol });
    const runtimeSession = await runtime.sessions.createThreadSession({ title: record.title });
    const now = new Date().toISOString();
    const session: PeaRuntimeProtocolSession = {
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
    this.registry?.upsert(sessionRecord(session, this.factory.runtimeId));
    return session;
  }

  private appendHistory(id: string, entry: PeaRuntimeSessionHistoryEntry): void {
    if (this.registry) {
      this.registry.appendHistory(id, entry);
      return;
    }

    this.inMemoryHistory.set(id, [...(this.inMemoryHistory.get(id) ?? []), entry]);
  }
}

function createPromptContext(
  session: PeaRuntimeProtocolSession,
  request: PeaRuntimeSendProtocolPromptRequest,
  restoredHistory: PeaRuntimeSessionHistoryEntry[] = [],
): PeaRuntimeContextEntry[] | undefined {
  const resourceEntries = createPeaRuntimeResourceContextEntries({
    scope: createPeaRuntimeResourceScope({
      cwd: session.cwd,
      additionalDirectories: session.additionalDirectories,
    }),
    resources: request.resources,
  });
  const restoredHistoryEntries =
    restoredHistory.length > 0
      ? [
          {
            description: "Pea restored protocol session history",
            value: JSON.stringify(restoredHistory, null, 2),
          },
        ]
      : [];
  const resumeEntries = createPeaRuntimeResumeContextEntries(request.resumeDecisions);
  const context = [
    ...(request.context ?? []),
    ...resourceEntries,
    ...resumeEntries,
    ...restoredHistoryEntries,
  ];
  return context.length > 0 ? context : undefined;
}

export function sessionInfo(session: PeaRuntimeProtocolSession): PeaRuntimeProtocolSessionInfo {
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

function recordInfo(record: PeaRuntimeSessionRecord): PeaRuntimeProtocolSessionInfo {
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

function sessionRecord(
  session: PeaRuntimeProtocolSession,
  runtimeId: PeaRuntimeFactory["runtimeId"],
): PeaRuntimeSessionRecord {
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
  if (!path.isAbsolute(resolved)) throw new Error(`Pea runtime cwd must be absolute: ${cwd}`);
  return resolved;
}

function normalizeAdditionalDirectories(additionalDirectories: string[]): string[] {
  return Array.from(
    new Set(
      additionalDirectories.map((directory) => {
        const resolved = path.resolve(directory);
        if (!path.isAbsolute(resolved))
          throw new Error(`Pea runtime additional directory must be absolute: ${directory}`);
        return resolved;
      }),
    ),
  );
}

function externalThreadKey(protocol: PeaRuntimeProtocol, externalThreadId: string): string {
  return `${protocol}:${externalThreadId}`;
}

function nextSessionNumber(
  idPrefix: string,
  records: PeaRuntimeSessionRecord[] | undefined,
): number {
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

function sanitizeHistoryPayload(payload: unknown): PeaJsonValue {
  return sanitizeJson(payload);
}

function mergeResumeDecisions(
  pending: PeaRuntimeResumeDecision[],
  supplied: PeaRuntimeResumeDecision[] | undefined,
): PeaRuntimeResumeDecision[] | undefined {
  const merged = [...pending, ...(supplied ?? [])];
  return merged.length > 0 ? merged : undefined;
}
