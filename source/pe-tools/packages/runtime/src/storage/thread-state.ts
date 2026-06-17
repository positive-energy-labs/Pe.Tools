import { ThreadStateStorage } from "@mastra/core/storage";

const tableName = "mastra_thread_state";

type LibSqlClient = {
  execute(statement: {
    sql: string;
    args?: unknown[];
  }): Promise<{ rows?: Record<string, unknown>[] }>;
};

export type RuntimeThreadStateStore = ThreadStateStorage;

export function createRuntimeLibSqlThreadStateStore(client: LibSqlClient): RuntimeThreadStateStore {
  return new RuntimeLibSqlThreadStateStore(client);
}

export function resolveRuntimeThreadStateStore(
  source: unknown,
): RuntimeThreadStateStore | undefined {
  const direct = maybeRuntimeThreadStateStore(source);
  if (direct) return direct;

  const record = readRecord(source);
  return (
    maybeStorageThreadStateStore(source) ??
    maybeStorageThreadStateStore(record.storage) ??
    maybeStorageThreadStateStore(readRecord(record.config).storage) ??
    maybeStorageThreadStateStore(callStorageAccessor(record)) ??
    maybeStorageThreadStateStore(callMastraStorageAccessor(record))
  );
}

function maybeStorageThreadStateStore(source: unknown): RuntimeThreadStateStore | undefined {
  const direct = maybeRuntimeThreadStateStore(source);
  if (direct) return direct;

  const threadState = readRecord(readRecord(source).stores).threadState;
  return maybeRuntimeThreadStateStore(threadState);
}

function callStorageAccessor(record: Record<string, unknown>): unknown {
  const getStorage = record.getStorage;
  return typeof getStorage === "function" ? getStorage.call(record) : undefined;
}

function callMastraStorageAccessor(record: Record<string, unknown>): unknown {
  const getMastra = record.getMastra;
  const mastra = typeof getMastra === "function" ? getMastra.call(record) : undefined;
  return callStorageAccessor(readRecord(mastra));
}

function maybeRuntimeThreadStateStore(value: unknown): RuntimeThreadStateStore | undefined {
  const record = readRecord(value);
  return typeof record.getState === "function" && typeof record.setState === "function"
    ? (value as RuntimeThreadStateStore)
    : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

class RuntimeLibSqlThreadStateStore extends ThreadStateStorage {
  constructor(private readonly client: LibSqlClient) {
    super();
  }

  async init(): Promise<void> {
    await this.client.execute({
      sql: `CREATE TABLE IF NOT EXISTS ${tableName} (
        thread_id TEXT NOT NULL,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, type)
      )`,
    });
  }

  async getState<T = unknown>(args: { threadId: string; type: string }): Promise<T | undefined> {
    await this.init();
    const result = await this.client.execute({
      sql: `SELECT value FROM ${tableName} WHERE thread_id = ? AND type = ?`,
      args: [args.threadId, args.type],
    });
    const value = result.rows?.[0]?.value;
    return typeof value === "string" ? (JSON.parse(value) as T) : undefined;
  }

  async setState<T = unknown>(args: { threadId: string; type: string; value: T }): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `INSERT INTO ${tableName} (thread_id, type, value, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(thread_id, type) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at`,
      args: [args.threadId, args.type, JSON.stringify(args.value)],
    });
  }

  async deleteState(args: { threadId: string; type: string }): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `DELETE FROM ${tableName} WHERE thread_id = ? AND type = ?`,
      args: [args.threadId, args.type],
    });
  }

  async dangerouslyClearAll(): Promise<void> {
    await this.init();
    await this.client.execute({ sql: `DELETE FROM ${tableName}` });
  }
}
