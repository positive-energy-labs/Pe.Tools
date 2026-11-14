/** Async diagnostic tails. Authored state and the synchronous store keep their existing policies. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StoredLog } from "./kinds.ts";

/** Callers serialize batches. A crash may tear this disposable diagnostic tail. */
export async function appendLinesBounded<T>(log: StoredLog<T>, values: readonly T[], maxLines: number): Promise<void> {
  if (!Number.isSafeInteger(maxLines) || maxLines < 1) throw Error("Log line limit must be positive");
  const prior = await readFile(log.path, "utf8").catch(error => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return "";
  });
  const lines = [...prior.split("\n").filter(Boolean), ...values.map(value => JSON.stringify(value))];
  await mkdir(dirname(log.path), { recursive: true });
  await writeFile(log.path, `${lines.slice(-maxLines).join("\n")}\n`);
}
