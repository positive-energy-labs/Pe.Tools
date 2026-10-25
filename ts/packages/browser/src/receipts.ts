import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SessionReceipt } from "./browser.ts";
import { BrowserError } from "./errors.ts";
// One owner budget covers graceful root exit, joined job termination, and profile cleanup.
export const CLOSE_BUDGET_MS = 60000;
export async function readClosingState(
  file: string,
): Promise<{ deadlineMs: number; receiptId: string } | undefined> {
  const text = await readPublication(join(dirname(file), "closing.json"), true);
  return text ? JSON.parse(text) : undefined;
}

async function readPublication(file: string, optional: boolean): Promise<string | undefined> {
  const deadline = Date.now() + 1500;
  while (true) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" && optional) return undefined;
      // Windows may briefly deny opening a just-published file. Never hide bad JSON or ACL errors.
      if (!["EBUSY", "EPERM", "ENOENT"].includes(code ?? "") || Date.now() >= deadline) throw error;
      await new Promise((done) => setTimeout(done, 25));
    }
  }
}

export async function readSessionReceipt(
  file: string,
  allowMissing = false,
  requireKeeperTerminal = false,
): Promise<SessionReceipt | undefined> {
  const terminal = await readPublication(join(dirname(file), "terminal.json"), true);
  const source = terminal ?? (await readPublication(file, allowMissing));
  if (source === undefined) return undefined;
  const receipt: SessionReceipt = JSON.parse(source);
  if (
    !receipt ||
    !receipt.info ||
    typeof receipt.info.id !== "string" ||
    typeof receipt.info.receiptId !== "string" ||
    typeof receipt.token !== "string" ||
    !Number.isInteger(receipt.controlPort) ||
    !["active", "closed"].includes(receipt.status)
  )
    throw new BrowserError("InvalidReceipt", `Invalid browser receipt ${file}`, {
      outcome: "not-sent",
    });
  if (
    !requireKeeperTerminal &&
    !terminal &&
    receipt.status === "active" &&
    receipt.info.custody === "owned"
  ) {
    const guardian = await readPublication(join(dirname(file), "guardian-cleanup.txt"), true);
    if (guardian === "clean") return { ...receipt, status: "closed" };
  }
  if (
    !requireKeeperTerminal &&
    !terminal &&
    receipt.status === "active" &&
    receipt.info.custody === "attached"
  ) {
    const guardian = await readPublication(join(dirname(file), "attached-cleanup.json"), true);
    if (guardian) {
      const cleanup: { remainingOwned: string[]; errors: string[] } = JSON.parse(guardian);
      return {
        ...receipt,
        status: "closed",
        ...(cleanup.errors.length || cleanup.remainingOwned.length
          ? {
              error: "Attached guardian could not certify complete target cleanup",
              errorCode: "CleanupFailed",
              errorData: cleanup,
            }
          : {}),
      };
    }
  }
  return receipt;
}

/** Ready and terminal are immutable separate publications, each with one writer. */
export async function publishJson(destination: string, value: unknown): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
export async function publishSessionReceipt(file: string, receipt: SessionReceipt): Promise<void> {
  await publishJson(
    receipt.status === "closed" ? join(dirname(file), "terminal.json") : file,
    receipt,
  );
}
