import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { discardStored, readStored, writeAtomic } from "@pe/host-contracts/store";
import type { RouteDocumentStore } from "@pe/runtime";
import { storedNoticesPath } from "./notice-feed.ts";

const recordSchema = z.object({
  format: z.literal("route-state-record-v2"),
  targetKey: z.string(),
  route: z.string(),
  value: z.unknown(),
});
const filename = (targetKey: string, route: string) =>
  `${createHash("sha256").update(`${route}:${targetKey}`).digest("hex")}.json`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const MISPLACED = "Stored Work identity does not match its address";

/**
 * Indexed Work carries its identity. Work is `discard` (ADR 0039 rule 1, ADR 0033 rule 5): a record
 * that does not decode, or sits at another address, is deleted with one notice in the feed. A read
 * and a listing apply the same rule, so no bad file is deleted by one and counted by the other.
 */
export function fileRouteDocumentStore(dir: string): RouteDocumentStore {
  mkdirSync(dir, { recursive: true });
  const work = (place: string) =>
    ({ class: "discard", place, notices: storedNoticesPath() }) as const;
  return {
    getState: async ({ targetKey, route }) => {
      const read = readStored(
        join(dir, filename(targetKey, route)),
        recordSchema.refine((r) => r.targetKey === targetKey && r.route === route, MISPLACED),
        work(`Work for ${route} (${targetKey})`),
      );
      return read.kind === "ok" ? read.value.value : null;
    },
    setState: async ({ targetKey, route, value, reason }) => {
      const path = join(dir, filename(targetKey, route));
      if (value == null) {
        // With a reason, the runtime refused the staged values inside a record that decoded here:
        // the same discard, in its words. Without one, a person cleared their own Work.
        if (reason) discardStored(path, work(`Work for ${route} (${targetKey})`), reason);
        else rmSync(path, { force: true });
        return;
      }
      writeAtomic(
        path,
        JSON.stringify({ format: "route-state-record-v2", targetKey, route, value }),
      );
    },
    listState: async () => {
      const files = (await readdir(dir)).filter((file) => /^[a-f0-9]{64}\.json$/.test(file)).sort();
      const records: { targetKey: string; route: string; value: unknown }[] = [];
      let unindexed = 0;
      let unreadable = 0;
      let bytesRead = 0;
      let truncated = files.length > 2000;
      // A snapshot reads at most 2,000 files, 16 MiB per file, and 32 MiB in total.
      for (const file of files.slice(0, 2000)) {
        try {
          const path = join(dir, file);
          const size = (await stat(path)).size;
          if (size > 16 * 1024 * 1024) {
            unreadable++;
            continue;
          }
          if (bytesRead + size > 32 * 1024 * 1024) {
            truncated = true;
            continue;
          }
          bytesRead += size;
          // The counts say what this listing met; the files themselves are gone after it.
          let indexed = true;
          const read = readStored(
            path,
            recordSchema.refine((r) => filename(r.targetKey, r.route) === file, MISPLACED),
            {
              ...work("Work"),
              parse: (text) => {
                const raw: unknown = JSON.parse(text);
                indexed = isRecord(raw) && "format" in raw;
                return raw;
              },
            },
          );
          if (read.kind === "ok") {
            if (read.value.value != null) records.push(read.value);
          } else if (read.kind === "discarded") indexed ? unreadable++ : unindexed++;
        } catch {
          unreadable++;
        }
      }
      return { records, unindexed, unreadable, truncated };
    },
  };
}
