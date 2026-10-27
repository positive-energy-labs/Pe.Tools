import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { convertLegacyWork, type RouteDocumentStore } from "@pe/runtime";

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

/** One canonical file contains its identity and value. Legacy hash-only files stay exact-key readable. */
export function fileRouteDocumentStore(dir: string): RouteDocumentStore {
  mkdirSync(dir, { recursive: true });
  // Cut over once at startup, before serving Work. Original bytes survive every write and crash.
  for (const file of readdirSync(dir).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
    const path = join(dir, file);
    try {
      const bytes = readFileSync(path);
      const record: unknown = JSON.parse(bytes.toString("utf8"));
      if (isRecord(record) && record.format === "route-state-record-v2") continue;
      const backup = `${path}.pre-shared-work`;
      if (!existsSync(backup)) writeFileSync(backup, bytes, { flag: "wx" });
      if (!isRecord(record) || record.format !== "route-state-record-v1" || typeof record.route !== "string") continue;
      const converted = { ...record, format: "route-state-record-v2", value: convertLegacyWork(record.value, record.route) };
      writeFileSync(`${path}.tmp`, JSON.stringify(converted));
      renameSync(`${path}.tmp`, path);
    } catch {
      // Conflicts/unreadable records stay exact and fail the normal schema read; no data is guessed.
    }
  }
  return {
    getState: async ({ targetKey, route }) => {
      const path = join(dir, filename(targetKey, route));
      if (!existsSync(path)) return null;
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(raw) || !("format" in raw)) throw Error("Unindexed historical Work needs explicit identity recovery; source bytes were retained");
      const record = recordSchema.parse(raw);
      if (record.targetKey !== targetKey || record.route !== route)
        throw new Error("Stored Work identity does not match its address");
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
