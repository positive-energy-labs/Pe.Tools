import { rename } from "node:fs/promises";

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * `rename` over an existing file. On Windows that fails EPERM/EBUSY while anything else (a virus
 * scanner, the indexer) briefly holds the target; the hold ends in milliseconds, so retry a few
 * times with a short backoff and then throw the real error.
 */
export async function renameReplacing(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !code || !TRANSIENT.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
