import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getDefaultMastraCodeAppDataDir,
  getDefaultPeaProductStateDirectory,
  type RuntimeStorageProfileKind,
} from "../storage/profiles.ts";
import type { RuntimeThreadLockInfo } from "../runtime.ts";

const require = createRequire(import.meta.url);

export class ThreadLockError extends Error {
  readonly threadId: string;
  readonly ownerPid: number;

  constructor(threadId: string, ownerPid: number) {
    super(`Thread ${threadId} is locked by another process (PID ${ownerPid})`);
    this.name = "ThreadLockError";
    this.threadId = threadId;
    this.ownerPid = ownerPid;
  }
}

export interface RuntimeThreadLockOptions {
  storageProfileKind?: RuntimeStorageProfileKind;
  threadLockErrorPrototype?: object | null;
}

const ownedLockPaths = new Set<string>();
let exitCleanupRegistered = false;

export function createRuntimeThreadLock(options: RuntimeThreadLockOptions = {}) {
  const locksDirectory = getLocksDirectory(options.storageProfileKind);
  const threadLockErrorPrototype =
    options.threadLockErrorPrototype ?? resolveMastraCodeThreadLockErrorPrototypeSync();
  registerExitCleanup();

  return {
    acquire(threadId: string): void {
      const lockPath = getLockPath(locksDirectory, threadId);
      const currentPid = process.pid;
      const pidText = String(currentPid);

      for (let attempts = 0; attempts < 8; attempts += 1) {
        try {
          fs.writeFileSync(lockPath, pidText, { mode: 0o644, flag: "wx" });
          ownedLockPaths.add(lockPath);
          return;
        } catch (error) {
          if (!isAlreadyExistsError(error)) throw error;
        }

        const ownerPid = readLockOwnerPid(lockPath);
        if (ownerPid === currentPid) {
          ownedLockPaths.add(lockPath);
          return;
        }
        if (ownerPid != null && isProcessAlive(ownerPid)) {
          throw createThreadLockError(threadId, ownerPid, threadLockErrorPrototype);
        }

        try {
          fs.unlinkSync(lockPath);
        } catch (error) {
          if (!isMissingFileError(error)) {
            const liveOwnerPid = readLockOwnerPid(lockPath);
            if (
              liveOwnerPid != null &&
              liveOwnerPid !== currentPid &&
              isProcessAlive(liveOwnerPid)
            ) {
              throw createThreadLockError(threadId, liveOwnerPid, threadLockErrorPrototype);
            }
          }
        }
      }

      throw new Error(`Unable to acquire thread lock for ${threadId}`);
    },
    release(threadId: string): void {
      releaseLockFile(getLockPath(locksDirectory, threadId), process.pid);
    },
  };
}

export function readRuntimeThreadLockInfo(
  threadId: string,
  options: RuntimeThreadLockOptions = {},
): RuntimeThreadLockInfo {
  const lockPath = getLockPath(getLocksDirectory(options.storageProfileKind), threadId);
  const ownerPid = readLockOwnerPid(lockPath);
  if (ownerPid == null) return { status: fs.existsSync(lockPath) ? "unknown" : "unlocked" };
  if (ownerPid === process.pid) return { status: "owned", ownerPid };
  return isProcessAlive(ownerPid) ? { status: "locked", ownerPid } : { status: "unlocked" };
}

export async function createRuntimeThreadLockWithMastraCodeInterop(
  options: RuntimeThreadLockOptions = {},
) {
  return createRuntimeThreadLock({
    ...options,
    threadLockErrorPrototype:
      options.threadLockErrorPrototype ?? (await resolveMastraCodeThreadLockErrorPrototype()),
  });
}

export function isThreadLockError(
  error: unknown,
): error is ThreadLockError & { threadId: string; ownerPid: number } {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<ThreadLockError>;
  return (
    error.name === "ThreadLockError" &&
    typeof candidate.threadId === "string" &&
    typeof candidate.ownerPid === "number"
  );
}

function getLocksDirectory(storageProfileKind: RuntimeStorageProfileKind | undefined): string {
  const rootDirectory =
    storageProfileKind === "mastracode-compatible"
      ? getDefaultMastraCodeAppDataDir()
      : getDefaultPeaProductStateDirectory();
  const locksDirectory = path.join(rootDirectory, "locks");
  if (!fs.existsSync(locksDirectory)) {
    fs.mkdirSync(locksDirectory, { recursive: true });
  }
  return locksDirectory;
}

function getLockPath(locksDirectory: string, threadId: string): string {
  const safeId = threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(locksDirectory, `${safeId}.lock`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function createThreadLockError(
  threadId: string,
  ownerPid: number,
  threadLockErrorPrototype: object | null,
): ThreadLockError {
  const error = new ThreadLockError(threadId, ownerPid);
  if (threadLockErrorPrototype) {
    Object.setPrototypeOf(error, threadLockErrorPrototype);
  }
  return error;
}

function readLockOwnerPid(lockPath: string): number | null {
  try {
    const ownerPid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    return Number.isNaN(ownerPid) ? null : ownerPid;
  } catch {
    return null;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function releaseLockFile(lockPath: string, currentPid: number): void {
  try {
    if (!fs.existsSync(lockPath)) return;

    const ownerPid = readLockOwnerPid(lockPath);
    if (ownerPid === currentPid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Best-effort cleanup only.
  } finally {
    ownedLockPaths.delete(lockPath);
  }
}

function registerExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;

  process.on("exit", () => {
    for (const lockPath of ownedLockPaths) {
      releaseLockFile(lockPath, process.pid);
    }
  });
}

async function resolveMastraCodeThreadLockErrorPrototype(): Promise<object | null> {
  const packageRoot = resolveMastraCodePackageRoot();
  if (!packageRoot) return null;

  return (
    (await resolveMastraCodeThreadLockErrorPrototypeFromEsm(packageRoot)) ??
    resolveMastraCodeThreadLockErrorPrototypeFromCjs(packageRoot)
  );
}

function resolveMastraCodeThreadLockErrorPrototypeSync(): object | null {
  const packageRoot = resolveMastraCodePackageRoot();
  return packageRoot ? resolveMastraCodeThreadLockErrorPrototypeFromCjs(packageRoot) : null;
}

function resolveMastraCodePackageRoot(): string | null {
  try {
    const packageJsonPath = require.resolve("mastracode/package.json");
    return path.dirname(packageJsonPath);
  } catch {
    return null;
  }
}

async function resolveMastraCodeThreadLockErrorPrototypeFromEsm(
  packageRoot: string,
): Promise<object | null> {
  for (const modulePath of mastraCodeDistChunks(packageRoot, ".js")) {
    if (!exportsThreadLockError(modulePath)) continue;

    try {
      const module = (await import(pathToFileURL(modulePath).href)) as {
        ThreadLockError?: { prototype?: object };
      };
      if (module.ThreadLockError?.prototype) return module.ThreadLockError.prototype;
    } catch {
      // Private MastraCode bundle shape varies; structural detection remains the fallback.
    }
  }

  return null;
}

function resolveMastraCodeThreadLockErrorPrototypeFromCjs(packageRoot: string): object | null {
  for (const modulePath of mastraCodeDistChunks(packageRoot, ".cjs")) {
    if (!exportsThreadLockError(modulePath)) continue;

    try {
      const module = require(modulePath) as {
        ThreadLockError?: { prototype?: object };
      };
      if (module.ThreadLockError?.prototype) return module.ThreadLockError.prototype;
    } catch {
      // Private MastraCode bundle shape varies; structural detection remains the fallback.
    }
  }

  return null;
}

function mastraCodeDistChunks(packageRoot: string, extension: ".js" | ".cjs"): string[] {
  const distDirectory = path.join(packageRoot, "dist");
  try {
    return fs
      .readdirSync(distDirectory)
      .filter((entry) => entry.startsWith("chunk-") && entry.endsWith(extension))
      .map((entry) => path.join(distDirectory, entry));
  } catch {
    return [];
  }
}

function exportsThreadLockError(modulePath: string): boolean {
  try {
    const content = fs.readFileSync(modulePath, "utf8");
    return content.includes("ThreadLockError") && content.includes("acquireThreadLock");
  } catch {
    return false;
  }
}
