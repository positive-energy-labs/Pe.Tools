import { mkdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path, { dirname } from "node:path";
import { LibSQLStore, type LibSQLConfig, type LibSQLLocalPragmaOptions } from "@mastra/libsql";
import type { MastraCompositeStore } from "@mastra/core/storage";
import type { RuntimeCreateRequest } from "../runtime.ts";

export type RuntimeStorageProfileKind = "libsql" | "mastracode-compatible" | "pea-product-state";
export type RuntimePathResolver = string | ((request: RuntimeCreateRequest) => string);

export interface RuntimeStorageProfile {
  id: string;
  kind: RuntimeStorageProfileKind;
  createStore(request: RuntimeCreateRequest): Promise<MastraCompositeStore>;
}

export type RuntimeLibSqlStorageConfig = Extract<LibSQLConfig, { url: string }>;

export interface RuntimeLibSqlStorageProfileOptions {
  id?: string;
  kind?: RuntimeStorageProfileKind;
  storageId?: string;
  url?: RuntimePathResolver;
  databasePath?: RuntimePathResolver;
  authToken?: string;
  localPragmas?: LibSQLLocalPragmaOptions;
  maxRetries?: number;
  initialBackoffMs?: number;
  disableInit?: boolean;
}

export interface RuntimeProductStateStorageProfileOptions {
  id?: string;
  storageId?: string;
  stateDirectory?: RuntimePathResolver;
  databaseFileName?: string;
}

export const runtimeLibSqlLocalPragmas: Required<LibSQLLocalPragmaOptions> = {
  cacheSize: -128_000,
  mmapSize: 536_870_912,
};

export function createRuntimeLibSqlStorageProfile(
  options: RuntimeLibSqlStorageProfileOptions = {},
): RuntimeStorageProfile {
  return {
    id: options.id ?? "libsql",
    kind: options.kind ?? "libsql",
    createStore: (request) =>
      createRuntimeLibSqlStorage(resolveRuntimeLibSqlConfig(options, request)),
  };
}

export async function createRuntimeLibSqlStorage(
  config: RuntimeLibSqlStorageConfig,
): Promise<MastraCompositeStore> {
  const localPath = localFilePathFromLibSqlUrl(config.url);
  if (localPath) await mkdir(dirname(localPath), { recursive: true });

  // LibSQLStore builds stores.threadState (ThreadStateLibSQL) by default.
  const store = new LibSQLStore(config);
  // Keyed by storage id, not instance: Mastra hands consumers an init-augmenting proxy of this store.
  legacyConfigs.set(store.id, { ...config });
  return store;
}

export function createMastraCodeStorageProfile(
  options: RuntimeProductStateStorageProfileOptions = {},
): RuntimeStorageProfile {
  return createRuntimeLibSqlStorageProfile({
    id: options.id ?? "mastracode-compatible",
    kind: "mastracode-compatible",
    storageId: options.storageId ?? "mastra-code-storage",
    databasePath: (request) => {
      const stateDirectory = resolveOptionalPath(options.stateDirectory, request);
      return stateDirectory
        ? path.join(stateDirectory, options.databaseFileName ?? "mastra.db")
        : getDefaultMastraCodeDatabasePath();
    },
    localPragmas: runtimeLibSqlLocalPragmas,
  });
}

export function createPeaProductStateStorageProfile(
  options: RuntimeProductStateStorageProfileOptions = {},
): RuntimeStorageProfile {
  return createRuntimeLibSqlStorageProfile({
    id: options.id ?? "pea-product-state",
    kind: "pea-product-state",
    storageId: options.storageId ?? "pea-product-state-storage",
    databasePath: (request) =>
      path.join(
        resolveOptionalPath(options.stateDirectory, request) ??
          getDefaultPeaProductStateDirectory(),
        options.databaseFileName ?? "mastra.db",
      ),
    localPragmas: runtimeLibSqlLocalPragmas,
  });
}

export function getDefaultMastraCodeDatabasePath(): string {
  if (process.env.MASTRA_DB_PATH) return process.env.MASTRA_DB_PATH;
  return path.join(getDefaultMastraCodeAppDataDir(), "mastra.db");
}

export function getDefaultMastraCodeAppDataDir(): string {
  const platformName = platform();
  const baseDir =
    platformName === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : platformName === "win32"
        ? process.env.APPDATA || path.join(homedir(), "AppData", "Roaming")
        : process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share");
  return path.join(baseDir, "mastracode");
}

export function getDefaultPeaProductStateDirectory(): string {
  if (process.env.PE_TOOLS_STATE_DIR) return process.env.PE_TOOLS_STATE_DIR;

  const platformName = platform();
  const baseDir =
    platformName === "darwin"
      ? path.join(homedir(), "Library", "Application Support")
      : platformName === "win32"
        ? process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local")
        : process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state");

  return path.join(baseDir, "Positive Energy", "Pe.Tools", "state");
}

export function getDefaultPeaProductDatabasePath(): string {
  return path.join(getDefaultPeaProductStateDirectory(), "mastra.db");
}

function resolveRuntimeLibSqlConfig(
  options: RuntimeLibSqlStorageProfileOptions,
  request: RuntimeCreateRequest,
): RuntimeLibSqlStorageConfig {
  const databasePath = resolvePath(options.databasePath ?? ":memory:", request);
  const url = options.url
    ? resolvePath(options.url, request)
    : databasePath === ":memory:"
      ? databasePath
      : `file:${databasePath}`;

  return {
    id: options.storageId ?? options.id ?? "libsql-storage",
    url,
    ...(options.authToken ? { authToken: options.authToken } : {}),
    localPragmas: options.localPragmas ?? runtimeLibSqlLocalPragmas,
    ...(options.maxRetries == null ? {} : { maxRetries: options.maxRetries }),
    ...(options.initialBackoffMs == null ? {} : { initialBackoffMs: options.initialBackoffMs }),
    ...(options.disableInit == null ? {} : { disableInit: options.disableInit }),
  };
}

function resolveOptionalPath(
  resolver: RuntimePathResolver | undefined,
  request: RuntimeCreateRequest,
): string | undefined {
  return resolver == null ? undefined : resolvePath(resolver, request);
}

function resolvePath(resolver: RuntimePathResolver, request: RuntimeCreateRequest): string {
  return typeof resolver === "function" ? resolver(request) : resolver;
}

function localFilePathFromLibSqlUrl(url: string): string | undefined {
  if (!url.startsWith("file:") || url.includes(":memory:")) return undefined;
  const localPath = url.slice("file:".length);
  return localPath.trim().length > 0 ? localPath : undefined;
}

const legacyConfigs = new Map<string, RuntimeLibSqlStorageConfig>();
export interface LegacyRouteStateSource {
  source: string;
  rows: { key: string; value: string }[];
}
/** Finite read-only census of the actual configured Mastra database, across every resource/type. */
export async function readLegacyRouteState(
  store: MastraCompositeStore,
): Promise<LegacyRouteStateSource> {
  const config = legacyConfigs.get(store.id);
  const file = config && localFilePathFromLibSqlUrl(config.url);
  if (!file) throw Error("Legacy route census requires a known configured local file database");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database
      .prepare(
        'SELECT "threadId", "type", "value" FROM "mastra_thread_state" ORDER BY "threadId", "type"',
      )
      .all();
    return {
      source: path.resolve(file),
      rows: rows.map((row) => {
        if (
          typeof row.threadId !== "string" ||
          typeof row.type !== "string" ||
          typeof row.value !== "string"
        )
          throw Error("Unreadable legacy thread-state row");
        return { key: JSON.stringify([row.threadId, row.type]), value: row.value };
      }),
    };
  } finally {
    database.close();
  }
}
