// Resolver for the native thread-state store. The custom LibSQL implementation
// was deleted: @mastra/libsql ships ThreadStateLibSQL and LibSQLStore builds
// `stores.threadState` by default. This only locates that native store.

export interface RuntimeThreadStateStore {
  getState(args: { threadId: string; type: string }): Promise<unknown>;
  setState<T = unknown>(args: { threadId: string; type: string; value: T }): Promise<void> | void;
  deleteState?(args: { threadId: string; type: string }): Promise<void> | void;
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
  return isRuntimeThreadStateStore(value) ? value : undefined;
}

function isRuntimeThreadStateStore(value: unknown): value is RuntimeThreadStateStore {
  const record = readRecord(value);
  return typeof record.getState === "function" && typeof record.setState === "function";
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
