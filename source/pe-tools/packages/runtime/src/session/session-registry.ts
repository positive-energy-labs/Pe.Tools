import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeJson, type RuntimeJsonValue, type RuntimeProtocol } from "../events.ts";

export type RuntimeId = string;
import type { RuntimeResumeDecision } from "../interrupts.ts";

export interface RuntimeSessionRecord {
  id: string;
  runtimeId: RuntimeId;
  protocol: RuntimeProtocol;
  cwd: string;
  additionalDirectories: string[];
  title: string;
  createdAt: string;
  updatedAt: string;
  threadId?: string;
  resourceId?: string;
  externalThreadId?: string;
  pendingResumeDecisions?: RuntimeResumeDecision[];
}

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

export interface RuntimeSessionRegistryFilter {
  runtimeId?: RuntimeId;
  protocol?: RuntimeProtocol;
  cwd?: string | null;
  externalThreadId?: string;
}

export interface RuntimeSessionRegistry {
  get(id: string): RuntimeSessionRecord | undefined;
  list(filter?: RuntimeSessionRegistryFilter): RuntimeSessionRecord[];
  upsert(record: RuntimeSessionRecord): void;
  history(id: string): RuntimeSessionHistoryEntry[];
  appendHistory(id: string, entry: RuntimeSessionHistoryEntry): void;
  replaceHistory(id: string, entries: RuntimeSessionHistoryEntry[]): void;
  delete(id: string): void;
}

interface RegistryFile {
  version: 1;
  sessions: RuntimeSessionRecord[];
  history: Record<string, RuntimeSessionHistoryEntry[]>;
}

export class FileRuntimeSessionRegistry implements RuntimeSessionRegistry {
  constructor(private readonly filePath: string) {}

  get(id: string): RuntimeSessionRecord | undefined {
    return this.read().sessions.find((session) => session.id === id);
  }

  list(filter: RuntimeSessionRegistryFilter = {}): RuntimeSessionRecord[] {
    return this.read()
      .sessions.filter((session) => !filter.runtimeId || session.runtimeId === filter.runtimeId)
      .filter((session) => !filter.protocol || session.protocol === filter.protocol)
      .filter((session) => !filter.cwd || normalizePath(session.cwd) === normalizePath(filter.cwd))
      .filter(
        (session) =>
          !filter.externalThreadId || session.externalThreadId === filter.externalThreadId,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  upsert(record: RuntimeSessionRecord): void {
    const file = this.read();
    const index = file.sessions.findIndex((session) => session.id === record.id);
    if (index >= 0) file.sessions[index] = record;
    else file.sessions.push(record);
    this.write(file);
  }

  delete(id: string): void {
    const file = this.read();
    const sessions = file.sessions.filter((session) => session.id !== id);
    const history = { ...file.history };
    delete history[id];
    if (sessions.length === file.sessions.length && file.history[id] === undefined) return;
    this.write({ ...file, sessions, history });
  }

  history(id: string): RuntimeSessionHistoryEntry[] {
    return [...(this.read().history[id] ?? [])];
  }

  appendHistory(id: string, entry: RuntimeSessionHistoryEntry): void {
    const file = this.read();
    file.history[id] = [...(file.history[id] ?? []), sanitizeHistoryEntry(entry)];
    this.write(file);
  }

  replaceHistory(id: string, entries: RuntimeSessionHistoryEntry[]): void {
    const file = this.read();
    file.history[id] = entries.map(sanitizeHistoryEntry);
    this.write(file);
  }

  private read(): RegistryFile {
    if (!existsSync(this.filePath)) return { version: 1, sessions: [], history: {} };
    const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<RegistryFile>;
    return {
      version: 1,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(isSessionRecord).map(normalizeRecord)
        : [],
      history: normalizeHistory(parsed.history),
    };
  }

  private write(file: RegistryFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  }
}

export function createRuntimeSessionRegistry(
  filePath: string | undefined | null,
): RuntimeSessionRegistry | undefined {
  return filePath ? new FileRuntimeSessionRegistry(path.resolve(filePath)) : undefined;
}

export function defaultRuntimeSessionRegistryPath(options: {
  runtimeId: RuntimeId;
  protocol?: RuntimeProtocol;
}): string {
  const root =
    process.env.PE_RUNTIME_SESSION_REGISTRY_DIR ||
    process.env.PEA_RUNTIME_SESSION_REGISTRY_DIR ||
    (process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Pe.Tools", "runtime", "protocol-sessions")
      : path.join(os.homedir(), ".pe", "runtime", "protocol-sessions"));
  const protocol = options.protocol ? `-${options.protocol}` : "";
  return path.join(root, `${options.runtimeId}${protocol}.sessions.json`);
}

function isSessionRecord(value: unknown): value is RuntimeSessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.runtimeId === "string" &&
    typeof record.protocol === "string" &&
    typeof record.cwd === "string" &&
    Array.isArray(record.additionalDirectories) &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

function normalizeRecord(record: RuntimeSessionRecord): RuntimeSessionRecord {
  return {
    ...record,
    cwd: normalizePath(record.cwd),
    additionalDirectories: record.additionalDirectories.map(normalizePath),
    pendingResumeDecisions: Array.isArray(record.pendingResumeDecisions)
      ? record.pendingResumeDecisions.map(sanitizeResumeDecision)
      : undefined,
  };
}

function normalizeHistory(
  history: Partial<RegistryFile>["history"] | undefined,
): Record<string, RuntimeSessionHistoryEntry[]> {
  if (typeof history !== "object" || history === null || Array.isArray(history)) return {};
  return Object.fromEntries(
    Object.entries(history)
      .filter(([id, entries]) => typeof id === "string" && Array.isArray(entries))
      .map(([id, entries]) => [
        id,
        (entries as unknown[]).filter(isHistoryEntry).map(sanitizeHistoryEntry),
      ]),
  );
}

function isHistoryEntry(value: unknown): value is RuntimeSessionHistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (entry.type === "prompt") {
    return typeof entry.content === "string" && typeof entry.createdAt === "string";
  }
  return (
    entry.type === "protocol_event" &&
    typeof entry.protocol === "string" &&
    typeof entry.createdAt === "string" &&
    "payload" in entry
  );
}

function sanitizeHistoryEntry(entry: RuntimeSessionHistoryEntry): RuntimeSessionHistoryEntry {
  if (entry.type === "prompt") return entry;
  return {
    ...entry,
    payload: sanitizeJson(entry.payload),
  };
}

function sanitizeResumeDecision(decision: RuntimeResumeDecision): RuntimeResumeDecision {
  return {
    interruptId: decision.interruptId,
    status: decision.status,
    ...(decision.payload === undefined ? {} : { payload: sanitizeJson(decision.payload) }),
  };
}

function normalizePath(value: string): string {
  return path.resolve(value);
}
