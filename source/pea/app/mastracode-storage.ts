import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import path, { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { MastraCompositeStore } from "@mastra/core/storage";

interface LibSqlStorageConfig {
  id: string;
  url: string;
  localPragmas?: Record<string, number>;
}

type LibSqlStoreConstructor = new (config: LibSqlStorageConfig) => MastraCompositeStore;

export interface LocalMastraCodeStorageConfig {
  id: string;
  url: string;
  localPragmas: Record<string, number>;
}

const require = createRequire(import.meta.url);
const mastraCodeLocalPragmas = {
  cacheSize: -128_000,
  mmapSize: 536_870_912,
};
let libSqlStoreTask: Promise<LibSqlStoreConstructor> | undefined;

export function createDefaultMastraCodeStorageConfig(): LocalMastraCodeStorageConfig {
  return createStorageConfig(getDefaultMastraCodeDatabasePath());
}

export function createPeaLocalStorageConfig(
  cwd: string,
  configDir = ".pea",
): LocalMastraCodeStorageConfig {
  return createStorageConfig(path.join(cwd, configDir, "mastra.db"));
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

export async function createDefaultMastraCodeStorage(): Promise<MastraCompositeStore> {
  return createLibSqlStorage(createDefaultMastraCodeStorageConfig());
}

export async function createPeaLocalStorage(
  cwd: string,
  configDir = ".pea",
): Promise<MastraCompositeStore> {
  return createLibSqlStorage(createPeaLocalStorageConfig(cwd, configDir));
}

async function createLibSqlStorage(
  config: LocalMastraCodeStorageConfig,
): Promise<MastraCompositeStore> {
  await mkdir(dirname(fileUrlPath(config.url)), { recursive: true });
  const LibSQLStore = await loadLibSqlStore();
  const storage = new LibSQLStore(config);
  await storage.init();
  return storage;
}

function createStorageConfig(databasePath: string): LocalMastraCodeStorageConfig {
  return {
    id: "mastra-code-storage",
    url: `file:${databasePath}`,
    localPragmas: mastraCodeLocalPragmas,
  };
}

function fileUrlPath(url: string): string {
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

async function loadLibSqlStore(): Promise<LibSqlStoreConstructor> {
  libSqlStoreTask ??= (async () => {
    const packageJsonPath = require.resolve("mastracode/package.json");
    const mastraCodeRequire = createRequire(packageJsonPath);
    const moduleUrl = pathToFileURL(mastraCodeRequire.resolve("@mastra/libsql")).href;
    const storageModule = (await import(moduleUrl)) as {
      LibSQLStore?: LibSqlStoreConstructor;
    };
    if (!storageModule.LibSQLStore) {
      throw new Error("MastraCode LibSQL storage is unavailable.");
    }
    return storageModule.LibSQLStore;
  })();

  return libSqlStoreTask;
}
