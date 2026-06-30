import fs from "node:fs";
import path from "node:path";
import {
  getDefaultMastraCodeAppDataDir,
  getDefaultPeaProductStateDirectory,
  type RuntimeStorageProfileKind,
} from "./storage/profiles.ts";
import type { RuntimeThreadLockInfo } from "./runtime.ts";

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
}

const ownedLockPaths = new Set<string>();
let exitCleanupRegistered = false;

export function createRuntimeThreadLock(options: RuntimeThreadLockOptions = {}) {
  const locksDirectory = getLocksDirectory(options.storageProfileKind);
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
          throw new ThreadLockError(threadId, ownerPid);
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
              throw new ThreadLockError(threadId, liveOwnerPid);
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

/**
 * Structural check for a thread-lock error. We match by name + fields rather than
 * `instanceof` so it recognizes our own errors and MastraCode's interchangeably
 * (both carry `name: "ThreadLockError"` plus `threadId`/`ownerPid`).
 */
export function isThreadLockError(
  error: unknown,
): error is ThreadLockError & { threadId: string; ownerPid: number } {
  if (!(error instanceof Error)) return false;
  const candidate = readRecord(error);
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

function readLockOwnerPid(lockPath: string): number | null {
  try {
    const ownerPid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    return Number.isNaN(ownerPid) ? null : ownerPid;
  } catch {
    return null;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return readStringProperty(error, "code") === "EEXIST";
}

function isMissingFileError(error: unknown): boolean {
  return readStringProperty(error, "code") === "ENOENT";
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

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readRecord(value)[key];
  return typeof property === "string" ? property : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
