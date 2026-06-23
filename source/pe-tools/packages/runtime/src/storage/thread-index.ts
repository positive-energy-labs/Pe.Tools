import { existsSync } from "node:fs";
import path from "node:path";
import { LibSQLStore, type LibSQLConfig, type LibSQLLocalPragmaOptions } from "@mastra/libsql";
import type { RuntimeProtocol } from "../events.ts";
import type { RuntimeThreadInfo, RuntimeThreadMessage } from "../runtime.ts";
import { readRuntimeThreadLockInfo } from "../harness/thread-lock.ts";
import {
  normalizeRuntimeMessageParts,
  parseRuntimeRawContent,
  runtimeMessageText,
} from "../message-parts.ts";
import {
  getDefaultPeaProductDatabasePath,
  runtimeLibSqlLocalPragmas,
  type RuntimeStorageProfileKind,
} from "./profiles.ts";

type LibSqlClient = {
  execute(statement: string | { sql: string; args?: unknown[] }): Promise<{
    rows?: Record<string, unknown>[];
  }>;
  close?: () => void;
};

export interface RuntimeThreadIndexListRequest {
  cwd?: string;
  protocol?: RuntimeProtocol;
}

export interface RuntimeRawThreadDatabaseRequest {
  threadId: string;
  resourceId?: string;
}

export interface RuntimeRawThreadDatabaseSnapshot {
  source: {
    url: string;
    localPath?: string;
  };
  tables: string[];
  threadRows: Record<string, unknown>[];
  messageRows: Record<string, unknown>[];
  resourceRows: Record<string, unknown>[];
  observationalMemoryRows: Record<string, unknown>[];
  threadStateRows: Record<string, unknown>[];
  errors: string[];
}

export interface RuntimeThreadIndex {
  listThreadSessions(request?: RuntimeThreadIndexListRequest): Promise<RuntimeThreadInfo[]>;
  readThreadMessages?(request: RuntimeRawThreadDatabaseRequest): Promise<RuntimeThreadMessage[]>;
  readThreadDatabaseSnapshot?(
    request: RuntimeRawThreadDatabaseRequest,
  ): Promise<RuntimeRawThreadDatabaseSnapshot>;
  close?(): Promise<void> | void;
}

export interface RuntimeLibSqlThreadIndexOptions {
  databasePath?: string;
  url?: string;
  storageId?: string;
  authToken?: string;
  localPragmas?: LibSQLLocalPragmaOptions;
  storageProfileKind?: RuntimeStorageProfileKind;
}

export function createRuntimeLibSqlThreadIndex(
  options: RuntimeLibSqlThreadIndexOptions = {},
): RuntimeThreadIndex {
  const url = options.url ?? `file:${options.databasePath ?? getDefaultPeaProductDatabasePath()}`;
  return new RuntimeLibSqlThreadIndex(
    {
      id: options.storageId ?? "runtime-thread-index",
      url,
      ...(options.authToken ? { authToken: options.authToken } : {}),
      localPragmas: options.localPragmas ?? runtimeLibSqlLocalPragmas,
    },
    options.storageProfileKind,
  );
}

class RuntimeLibSqlThreadIndex implements RuntimeThreadIndex {
  private client: LibSqlClient | null = null;

  constructor(
    private readonly config: Extract<LibSQLConfig, { url: string }>,
    private readonly storageProfileKind: RuntimeStorageProfileKind | undefined,
  ) {}

  async listThreadSessions(): Promise<RuntimeThreadInfo[]> {
    const localPath = localFilePathFromLibSqlUrl(this.config.url);
    if (localPath && !existsSync(localPath)) return [];

    try {
      const result = await this.getClient().execute({
        sql: `SELECT id, resourceId, title, metadata, createdAt, updatedAt
          FROM mastra_threads
          ORDER BY updatedAt DESC, createdAt DESC`,
      });
      return (result.rows ?? []).flatMap((row) => {
        const threadId = stringValue(row.id);
        const resourceId = stringValue(row.resourceId);
        if (!threadId || !resourceId) return [];
        const title = stringValue(row.title);
        const cwd = localCwdFromResourceId(resourceId);
        const createdAt = timestampValue(row.createdAt);
        const updatedAt = timestampValue(row.updatedAt);
        const metadata = metadataValue(row.metadata);

        return [
          {
            threadId,
            resourceId,
            ...(title ? { title } : {}),
            ...(cwd ? { cwd } : {}),
            ...(createdAt ? { createdAt } : {}),
            ...(updatedAt ? { updatedAt } : {}),
            lock: readRuntimeThreadLockInfo(threadId, {
              storageProfileKind: this.storageProfileKind,
            }),
            ...(metadata ? { metadata } : {}),
          },
        ];
      });
    } catch (error) {
      if (isMissingThreadsTableError(error)) return [];
      throw error;
    }
  }

  async readThreadDatabaseSnapshot(
    request: RuntimeRawThreadDatabaseRequest,
  ): Promise<RuntimeRawThreadDatabaseSnapshot> {
    const localPath = localFilePathFromLibSqlUrl(this.config.url);
    const empty = {
      source: {
        url: this.config.url,
        ...(localPath ? { localPath } : {}),
      },
      tables: [],
      threadRows: [],
      messageRows: [],
      resourceRows: [],
      observationalMemoryRows: [],
      threadStateRows: [],
      errors: [],
    } satisfies RuntimeRawThreadDatabaseSnapshot;

    if (localPath && !existsSync(localPath)) {
      return {
        ...empty,
        errors: [`Database file does not exist: ${localPath}`],
      };
    }

    const errors: string[] = [];
    const tables = await this.readTables(errors);
    const threadRows = await this.readRows(
      tables,
      "mastra_threads",
      {
        sql: `SELECT * FROM mastra_threads WHERE id = ?`,
        args: [request.threadId],
      },
      errors,
    );
    const resourceId = request.resourceId ?? stringValue(threadRows[0]?.resourceId);
    const resourceRows = resourceId
      ? await this.readRows(
          tables,
          "mastra_resources",
          {
            sql: `SELECT * FROM mastra_resources WHERE id = ?`,
            args: [resourceId],
          },
          errors,
        )
      : [];

    const omLookupKeys = [
      `thread:${request.threadId}`,
      ...(resourceId ? [`resource:${resourceId}`] : []),
    ];
    const omConditions = [
      `"threadId" = ?`,
      ...(resourceId ? [`"resourceId" = ?`] : []),
      `"lookupKey" IN (${omLookupKeys.map(() => "?").join(", ")})`,
    ];
    const omArgs = [request.threadId, ...(resourceId ? [resourceId] : []), ...omLookupKeys];

    return {
      ...empty,
      tables,
      threadRows: normalizeRows(threadRows),
      messageRows: normalizeRows(
        await this.readRows(
          tables,
          "mastra_messages",
          {
            sql: `SELECT * FROM mastra_messages WHERE thread_id = ? ORDER BY "createdAt" ASC`,
            args: [request.threadId],
          },
          errors,
        ),
      ),
      resourceRows: normalizeRows(resourceRows),
      observationalMemoryRows: normalizeRows(
        await this.readRows(
          tables,
          "mastra_observational_memory",
          {
            sql: `SELECT * FROM mastra_observational_memory WHERE ${omConditions.join(
              " OR ",
            )} ORDER BY "generationCount" DESC, "updatedAt" DESC`,
            args: omArgs,
          },
          errors,
        ),
      ),
      threadStateRows: normalizeRows(
        await this.readRows(
          tables,
          "mastra_thread_state",
          {
            sql: `SELECT * FROM mastra_thread_state WHERE thread_id = ? ORDER BY type ASC`,
            args: [request.threadId],
          },
          errors,
        ),
      ),
      errors,
    };
  }

  async readThreadMessages(
    request: RuntimeRawThreadDatabaseRequest,
  ): Promise<RuntimeThreadMessage[]> {
    const localPath = localFilePathFromLibSqlUrl(this.config.url);
    if (localPath && !existsSync(localPath)) return [];

    try {
      const resourcePredicate = request.resourceId ? ` AND "resourceId" = ?` : "";
      const result = await this.getClient().execute({
        sql: `SELECT id, role, type, content, createdAt
          FROM mastra_messages
          WHERE thread_id = ?${resourcePredicate}
          ORDER BY "createdAt" ASC`,
        args: [request.threadId, ...(request.resourceId ? [request.resourceId] : [])],
      });
      return (result.rows ?? []).flatMap((row) => {
        const message = runtimeThreadMessageFromRow(row);
        return message.text.length > 0 || (message.parts ?? []).some(isRuntimeToolPart)
          ? [message]
          : [];
      });
    } catch (error) {
      if (isMissingMessagesTableError(error)) return [];
      throw error;
    }
  }

  close(): void {
    this.client?.close?.();
    this.client = null;
  }

  private async readTables(errors: string[]): Promise<string[]> {
    try {
      const result = await this.getClient().execute({
        sql: `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      });
      return (result.rows ?? []).flatMap((row) => {
        const name = stringValue(row.name);
        return name ? [name] : [];
      });
    } catch (error) {
      errors.push(errorMessage(error));
      return [];
    }
  }

  private async readRows(
    tables: string[],
    tableName: string,
    statement: { sql: string; args?: unknown[] },
    errors: string[],
  ): Promise<Record<string, unknown>[]> {
    if (!tables.includes(tableName)) return [];

    try {
      return (await this.getClient().execute(statement)).rows ?? [];
    } catch (error) {
      errors.push(`${tableName}: ${errorMessage(error)}`);
      return [];
    }
  }

  private getClient(): LibSqlClient {
    if (this.client) return this.client;

    const store = new LibSQLStore(this.config);
    const client = readRecord(store).client;
    if (!isLibSqlClient(client)) throw new Error("LibSQL thread index client is unavailable.");

    this.client = client;
    return client;
  }
}

function localFilePathFromLibSqlUrl(url: string): string | undefined {
  if (!url.startsWith("file:") || url.includes(":memory:")) return undefined;
  const localPath = url.slice("file:".length);
  return localPath.trim().length > 0 ? localPath : undefined;
}

function localCwdFromResourceId(resourceId: string): string | undefined {
  const separatorIndex = resourceId.indexOf(":");
  if (separatorIndex < 0) return undefined;

  try {
    const decoded = Buffer.from(resourceId.slice(separatorIndex + 1), "base64url").toString(
      "utf-8",
    );
    const resolved = path.resolve(decoded);
    return path.isAbsolute(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function timestampValue(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "bigint") return new Date(Number(value)).toISOString();
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : trimmed;
}

function metadataValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return metadataValue(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return isRecord(value) ? value : undefined;
}

function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])),
  );
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function runtimeThreadMessageFromRow(row: Record<string, unknown>): RuntimeThreadMessage {
  const role = runtimeMessageRole(row.role, row.type);
  const type = stringValue(row.type);
  const createdAt = timestampValue(row.createdAt);
  const text = runtimeMessageText(row.content);
  const parts = normalizeRuntimeMessageParts(row.content);
  const rawContent = parseRuntimeRawContent(row.content);
  return {
    id: stringValue(row.id) ?? stableRuntimeMessageId({ role, type, text, createdAt }),
    role,
    ...(type ? { type } : {}),
    text,
    ...(parts.length > 0 ? { parts } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(rawContent !== undefined ? { rawContent } : {}),
  };
}

function isRuntimeToolPart(part: NonNullable<RuntimeThreadMessage["parts"]>[number]): boolean {
  return part.type === "tool-call" || part.type === "tool-result";
}

function runtimeMessageRole(role: unknown, type: unknown): RuntimeThreadMessage["role"] {
  if (role === "assistant" || role === "system" || role === "tool") return role;
  if (role === "user") return "user";
  if (role === "signal" && type === "user") return "user";
  return "signal";
}

function stableRuntimeMessageId(message: {
  role: RuntimeThreadMessage["role"];
  type?: string;
  text: string;
  createdAt?: string;
}): string {
  return `message:${Buffer.from(
    JSON.stringify([message.role, message.type ?? "", message.createdAt ?? "", message.text]),
  )
    .toString("base64url")
    .slice(0, 24)}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isMissingThreadsTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*mastra_threads/i.test(message);
}

function isMissingMessagesTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*mastra_messages/i.test(message);
}

function isLibSqlClient(value: unknown): value is LibSqlClient {
  return typeof readRecord(value).execute === "function";
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
