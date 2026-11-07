import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RouteDocumentStore } from "@pe/runtime";

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

/** Indexed Work carries its identity; unreadable records remain available for inspection. */
export function fileRouteDocumentStore(dir: string): RouteDocumentStore {
  mkdirSync(dir, { recursive: true });
  return {
    getState: async ({ targetKey, route }) => {
      const path = join(dir, filename(targetKey, route));
      if (!existsSync(path)) return null;
      // ADR 0033 rule 5 exception (2026-11-07, PROVISIONAL pending kaitpw): refuse and keep
      // all unreadable bytes. Only a proven older schema permits explicit Start fresh to set
      // bytes aside; corruption, newer/unknown schemas and identity mismatches get no reset.
      // No migration or conversion is permitted.
      const unreadable = (reason: string) =>
        Object.assign(Error(`Stored Work '${targetKey}' (${route}) cannot be read: ${reason}`), {
          code: "WorkUnreadable",
          key: targetKey,
          reason,
        });
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if (error instanceof SyntaxError) throw unreadable(error.message);
        throw error;
      }
      const parsed = recordSchema.safeParse(raw);
      if (!parsed.success) throw unreadable(parsed.error.message);
      const record = parsed.data;
      if (record.targetKey !== targetKey || record.route !== route)
        throw unreadable("Stored Work identity does not match its address");
      return record.value;
    },
    setState: async ({ targetKey, route, value }) => {
      const path = join(dir, filename(targetKey, route));
      if (value == null) return rmSync(path, { force: true });
      writeFileSync(
        `${path}.tmp`,
        JSON.stringify({ format: "route-state-record-v2", targetKey, route, value }),
      );
      renameSync(`${path}.tmp`, path);
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
          const raw: unknown = JSON.parse(await readFile(path, "utf8"));
          if (!isRecord(raw) || !("format" in raw)) {
            unindexed++;
            continue;
          }
          const record = recordSchema.safeParse(raw);
          if (!record.success || filename(record.data.targetKey, record.data.route) !== file) {
            unreadable++;
            continue;
          }
          if (record.data.value != null) records.push(record.data);
        } catch {
          unreadable++;
        }
      }
      return { records, unindexed, unreadable, truncated };
    },
  };
}
