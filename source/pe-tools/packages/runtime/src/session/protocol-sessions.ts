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
import type { RuntimeFactory, RuntimeHandle, RuntimeThreadInfo } from "../runtime.ts";

export type RuntimeSessionHistoryEntry =
  | {
      type: "prompt";
      content: string;
      createdAt: string;
    }
  | {
      type: "protocol_event";
      protocol: RuntimeProtocol;
      payload: RuntimeJsonValue;
      createdAt: string;
    };

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
  defaultCwd?: string;
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
  private readonly sessions = new Map<string, RuntimeProtocolSession>();
  private readonly externalThreadIndex = new Map<string, string>();
  private readonly inMemoryHistory = new Map<string, RuntimeSessionHistoryEntry[]>();

  constructor(private readonly options: RuntimeProtocolSessionsOptions) {
    this.factory = options.factory;
  }

  async createSession(
    request: RuntimeCreateProtocolSessionRequest,
  ): Promise<RuntimeProtocolSession> {
    const cwd = normalizeCwd(request.cwd ?? this.options.defaultCwd ?? process.cwd());
    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    const title = request.title ?? `${request.protocol} session`;
    const runtime = await this.factory.create({
      cwd,
      workspaceRoot: cwd,
      additionalDirectories,
      protocol: request.protocol,
    });
    const runtimeSession = await runtime.sessions.createThreadSession({ title });
    const now = new Date().toISOString();

    const session: RuntimeProtocolSession = {
      id: runtimeSession.threadId,
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

    this.trackSession(session);
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
    const source = await this.sourceSession(sourceId, {
      cwd: request.cwd,
      protocol: request.protocol,
    });
    if (request.protocol && source.protocol !== request.protocol) {
      throw new Error(
        `Runtime session ${sourceId} belongs to protocol '${source.protocol}' and cannot fork as '${request.protocol}'.`,
      );
    }

    const sourceHistory = this.history(sourceId);
    const session = await this.createSession({
      protocol: source.protocol,
      cwd: request.cwd,
      additionalDirectories: request.additionalDirectories,
      title: request.title ?? `${source.title} fork`,
    });
    await seedHarnessSandboxAllowedPaths(
      session.runtime,
      harnessSandboxAllowedPaths(source.runtime),
    );
    if (sourceHistory.length > 0) this.inMemoryHistory.set(session.id, [...sourceHistory]);
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
      request.additionalDirectories ?? session.additionalDirectories,
    );
    session.updatedAt = new Date().toISOString();
    return session;
  }

  async listSessions(
    filter: { cwd?: string | null; protocol?: RuntimeProtocol } = {},
  ): Promise<RuntimeProtocolSessionInfo[]> {
    const cwd = normalizeCwd(filter.cwd ?? this.options.defaultCwd ?? process.cwd());
    const active = Array.from(this.sessions.values())
      .filter((session) => !filter.protocol || session.protocol === filter.protocol)
      .filter((session) => normalizeCwd(session.cwd) === cwd)
      .map(sessionInfo);
    const activeIds = new Set(active.map((session) => session.id));
    const activeSession = active.at(0);
    const runtime = activeSession
      ? this.getSession(activeSession.id).runtime
      : await this.createListRuntime(cwd, filter.protocol ?? "acp");

    try {
      const threads = (await runtime.sessions.listThreadSessions?.()) ?? [];
      const listed = threads
        .filter((thread) => !activeIds.has(thread.threadId))
        .map((thread) => threadInfo(thread, { cwd, protocol: filter.protocol ?? "acp" }));
      return [...active, ...listed].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    } finally {
      if (!activeSession) await runtime.close?.();
    }
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
    return [...(this.inMemoryHistory.get(id) ?? [])];
  }

  recordResumeDecision(id: string, decision: RuntimeResumeDecision): void {
    const session = this.getSession(id);
    session.pendingResumeDecisions = [...session.pendingResumeDecisions, decision];
    session.updatedAt = new Date().toISOString();
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
    this.appendHistory(id, {
      type: "prompt",
      content: request.content,
      createdAt: session.updatedAt,
    });
    const consumedResumeDecisions = session.pendingResumeDecisions;
    const resumeDecisions = mergeResumeDecisions(consumedResumeDecisions, request.resumeDecisions);
    session.pendingResumeDecisions = [];
    try {
      await session.runtime.sessions.switchThread({ threadId: session.threadId });
      await session.runtime.sessions.sendMessage({
        content: request.content,
        context: createPromptContext(session, { ...request, resumeDecisions }),
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
    }
  }

  cancel(id: string): void {
    const session = this.getSession(id);
    session.cancelled = true;
    session.updatedAt = new Date().toISOString();
    session.runtime.sessions.abort();
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
    await session.runtime.close?.();
  }

  async closeAll(): Promise<void> {
    for (const sessionId of Array.from(this.sessions.keys())) await this.close(sessionId);
  }

  async delete(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      await session.runtime.sessions.deleteThreadSession?.({ threadId: session.threadId });
      await this.close(id);
    } else {
      const cwd = normalizeCwd(this.options.defaultCwd ?? process.cwd());
      const runtime = await this.createListRuntime(cwd, "acp");
      try {
        await runtime.sessions.deleteThreadSession?.({ threadId: id });
      } finally {
        await runtime.close?.();
      }
    }
    this.inMemoryHistory.delete(id);
  }

  private async sourceSession(
    id: string,
    request: {
      cwd?: string;
      protocol?: RuntimeProtocol;
    },
  ): Promise<RuntimeProtocolSession> {
    const session = this.sessions.get(id);
    if (session) return session;
    return this.rehydrateSession(id, request);
  }

  private async rehydrateSession(
    id: string,
    request: {
      cwd?: string;
      additionalDirectories?: string[];
      protocol?: RuntimeProtocol;
    },
  ): Promise<RuntimeProtocolSession> {
    const cwd = normalizeCwd(request.cwd ?? this.options.defaultCwd ?? process.cwd());
    const additionalDirectories = normalizeAdditionalDirectories(
      request.additionalDirectories ?? [],
    );
    const protocol = request.protocol ?? "acp";
    const runtime = await this.factory.create({
      cwd,
      workspaceRoot: cwd,
      additionalDirectories,
      protocol,
    });
    await runtime.sessions.switchThread({ threadId: id });
    const thread = (await runtime.sessions.listThreadSessions?.())?.find(
      (candidate) => candidate.threadId === id,
    );
    await seedHarnessSandboxAllowedPaths(
      runtime,
      metadataSandboxAllowedPaths(thread?.metadata),
    );
    const now = new Date().toISOString();
    const session: RuntimeProtocolSession = {
      id,
      protocol,
      cwd: runtime.workspace?.cwd ?? cwd,
      additionalDirectories,
      title: thread?.title ?? `${protocol} session`,
      runtime,
      threadId: id,
      resourceId: thread?.resourceId ?? runtime.sessions.getResourceId?.() ?? "",
      createdAt: thread?.createdAt ?? now,
      updatedAt: thread?.updatedAt ?? now,
      cancelled: false,
      promptActive: false,
      pendingResumeDecisions: [],
      restoredFromRegistry: false,
      emitQueue: Promise.resolve(),
      unsubscribe: () => undefined,
    };

    this.trackSession(session);
    return session;
  }

  private async createListRuntime(cwd: string, protocol: RuntimeProtocol): Promise<RuntimeHandle> {
    return this.factory.create({ cwd, workspaceRoot: cwd, additionalDirectories: [], protocol });
  }

  private trackSession(session: RuntimeProtocolSession): void {
    this.sessions.set(session.id, session);
    if (session.externalThreadId) {
      this.externalThreadIndex.set(
        externalThreadKey(session.protocol, session.externalThreadId),
        session.id,
      );
    }
  }

  private appendHistory(id: string, entry: RuntimeSessionHistoryEntry): void {
    this.inMemoryHistory.set(id, [...(this.inMemoryHistory.get(id) ?? []), entry]);
  }

}

function createPromptContext(
  session: RuntimeProtocolSession,
  request: RuntimeSendProtocolPromptRequest,
): RuntimeContextEntry[] | undefined {
  const resourceEntries = createRuntimeResourceContextEntries({
    scope: createRuntimeResourceScope({
      cwd: session.cwd,
      additionalDirectories: sessionAdditionalDirectories(session),
    }),
    resources: request.resources,
  });
  const resumeEntries = createRuntimeResumeContextEntries(request.resumeDecisions);
  const context = [...(request.context ?? []), ...resourceEntries, ...resumeEntries];
  return context.length > 0 ? context : undefined;
}

export function sessionInfo(session: RuntimeProtocolSession): RuntimeProtocolSessionInfo {
  return {
    id: session.id,
    protocol: session.protocol,
    cwd: session.cwd,
    additionalDirectories: sessionAdditionalDirectories(session),
    title: session.title,
    threadId: session.threadId,
    resourceId: session.resourceId,
    ...(session.externalThreadId ? { externalThreadId: session.externalThreadId } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    promptActive: session.promptActive,
  };
}

function sessionAdditionalDirectories(session: RuntimeProtocolSession): string[] {
  const harnessState = harnessSandboxState(session.runtime);
  return normalizeAdditionalDirectories([
    ...session.additionalDirectories,
    ...(harnessState?.sandboxAllowedPaths ?? []),
  ]);
}

function harnessSandboxState(runtime: RuntimeHandle):
  | { sandboxAllowedPaths?: string[] }
  | undefined {
  return runtime.harness.getState() as { sandboxAllowedPaths?: string[] } | undefined;
}

function harnessSandboxAllowedPaths(runtime: RuntimeHandle): string[] {
  return normalizeOptionalSandboxPaths(harnessSandboxState(runtime)?.sandboxAllowedPaths);
}

async function seedHarnessSandboxAllowedPaths(
  runtime: RuntimeHandle,
  sandboxAllowedPaths: string[],
): Promise<void> {
  if (sandboxAllowedPaths.length === 0) return;
  await runtime.harness.setState({
    sandboxAllowedPaths,
  } as Partial<Record<string, unknown>>);
}

function metadataSandboxAllowedPaths(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.sandboxAllowedPaths;
  return Array.isArray(value) ? normalizeOptionalSandboxPaths(value) : [];
}

function normalizeOptionalSandboxPaths(paths: readonly unknown[] | undefined): string[] {
  if (!paths) return [];
  return normalizeAdditionalDirectories(paths.filter((entry): entry is string => typeof entry === "string"));
}

function threadInfo(
  thread: RuntimeThreadInfo,
  options: { cwd: string; protocol: RuntimeProtocol },
): RuntimeProtocolSessionInfo {
  return {
    id: thread.threadId,
    protocol: options.protocol,
    cwd: options.cwd,
    additionalDirectories: [],
    title: thread.title ?? `${options.protocol} session`,
    threadId: thread.threadId,
    resourceId: thread.resourceId,
    createdAt: thread.createdAt ?? new Date(0).toISOString(),
    updatedAt: thread.updatedAt ?? thread.createdAt ?? new Date(0).toISOString(),
    promptActive: false,
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
