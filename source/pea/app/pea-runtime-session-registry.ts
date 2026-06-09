import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PeaRuntimeId } from "./pea-runtime.js";
import { sanitizeJson, type PeaJsonValue, type PeaRuntimeProtocol } from "./pea-runtime-events.js";
import type { PeaRuntimeResumeDecision } from "./pea-runtime-interrupts.js";

export interface PeaRuntimeSessionRecord {
  id: string;
  runtimeId: PeaRuntimeId;
  protocol: PeaRuntimeProtocol;
  cwd: string;
  additionalDirectories: string[];
  title: string;
  createdAt: string;
  updatedAt: string;
  threadId?: string;
  resourceId?: string;
  externalThreadId?: string;
  pendingResumeDecisions?: PeaRuntimeResumeDecision[];
}

export type PeaRuntimeSessionHistoryEntry =
  | {
      type: "prompt";
      content: string;
      createdAt: string;
    }
  | {
      type: "protocol_event";
      protocol: PeaRuntimeProtocol;
      payload: PeaJsonValue;
      createdAt: string;
    };

export interface PeaRuntimeSessionRegistryFilter {
  runtimeId?: PeaRuntimeId;
  protocol?: PeaRuntimeProtocol;
  cwd?: string | null;
  externalThreadId?: string;
}

export interface PeaRuntimeSessionRegistry {
  get(id: string): PeaRuntimeSessionRecord | undefined;
  list(filter?: PeaRuntimeSessionRegistryFilter): PeaRuntimeSessionRecord[];
  upsert(record: PeaRuntimeSessionRecord): void;
  history(id: string): PeaRuntimeSessionHistoryEntry[];
  appendHistory(id: string, entry: PeaRuntimeSessionHistoryEntry): void;
  replaceHistory(id: string, entries: PeaRuntimeSessionHistoryEntry[]): void;
  delete(id: string): void;
}

interface RegistryFile {
  version: 1;
  sessions: PeaRuntimeSessionRecord[];
  history: Record<string, PeaRuntimeSessionHistoryEntry[]>;
}

export class FilePeaRuntimeSessionRegistry implements PeaRuntimeSessionRegistry {
  constructor(private readonly filePath: string) {}

  get(id: string): PeaRuntimeSessionRecord | undefined {
    return this.read().sessions.find((session) => session.id === id);
  }

  list(filter: PeaRuntimeSessionRegistryFilter = {}): PeaRuntimeSessionRecord[] {
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

  upsert(record: PeaRuntimeSessionRecord): void {
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

  history(id: string): PeaRuntimeSessionHistoryEntry[] {
    return [...(this.read().history[id] ?? [])];
  }

  appendHistory(id: string, entry: PeaRuntimeSessionHistoryEntry): void {
    const file = this.read();
    file.history[id] = [...(file.history[id] ?? []), sanitizeHistoryEntry(entry)];
    this.write(file);
  }

  replaceHistory(id: string, entries: PeaRuntimeSessionHistoryEntry[]): void {
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

export function createPeaRuntimeSessionRegistry(
  filePath: string | undefined | null,
): PeaRuntimeSessionRegistry | undefined {
  return filePath ? new FilePeaRuntimeSessionRegistry(path.resolve(filePath)) : undefined;
}

export function defaultPeaRuntimeSessionRegistryPath(options: {
  runtimeId: PeaRuntimeId;
  protocol?: PeaRuntimeProtocol;
}): string {
  const root =
    process.env.PEA_RUNTIME_SESSION_REGISTRY_DIR ||
    (process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Pe.Tools", "pea", "protocol-sessions")
      : path.join(os.homedir(), ".pea", "protocol-sessions"));
  const protocol = options.protocol ? `-${options.protocol}` : "";
  return path.join(root, `${options.runtimeId}${protocol}.sessions.json`);
}

function isSessionRecord(value: unknown): value is PeaRuntimeSessionRecord {
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

function normalizeRecord(record: PeaRuntimeSessionRecord): PeaRuntimeSessionRecord {
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
): Record<string, PeaRuntimeSessionHistoryEntry[]> {
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

function isHistoryEntry(value: unknown): value is PeaRuntimeSessionHistoryEntry {
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

function sanitizeHistoryEntry(entry: PeaRuntimeSessionHistoryEntry): PeaRuntimeSessionHistoryEntry {
  if (entry.type === "prompt") return entry;
  return {
    ...entry,
    payload: sanitizeJson(entry.payload),
  };
}

function sanitizeResumeDecision(decision: PeaRuntimeResumeDecision): PeaRuntimeResumeDecision {
  return {
    interruptId: decision.interruptId,
    status: decision.status,
    ...(decision.payload === undefined ? {} : { payload: sanitizeJson(decision.payload) }),
  };
}

function normalizePath(value: string): string {
  return path.resolve(value);
}
