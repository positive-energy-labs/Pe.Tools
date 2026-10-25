import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { osUserProductRoot } from "@pe/host-contracts/service-identity";
import { BrowserError } from "./errors.ts";

export interface AttachmentLock {
  path: string;
  marker: string;
}
export async function acquireAttachment(
  endpoint: string,
  identity: { id: string; home: string; receipt: string; receiptId: string },
): Promise<AttachmentLock> {
  // Chrome's browser id is stable across localhost aliases and proxy origins.
  const key = createHash("sha256").update(new URL(endpoint).pathname).digest("hex");
  // Exclusion spans explicit browser homes and product-home overrides for this OS user.
  const directory = join(osUserProductRoot(), "state", "browser", "attachments");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${key}.json`);
  const marker = JSON.stringify(identity);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    let existing: unknown;
    try {
      existing = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new BrowserError(
      "AttachmentBusy",
      "This browser already has an attachment keeper; connect to its existing session or explicitly retire it",
      { outcome: "not-sent", endpoint, data: { existing, lock: path } },
    );
  }
  try {
    await handle.writeFile(marker);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { path, marker };
}
export async function releaseAttachment(lock: AttachmentLock): Promise<void> {
  try {
    if ((await readFile(lock.path, "utf8")) === lock.marker) await rm(lock.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
