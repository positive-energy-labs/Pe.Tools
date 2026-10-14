import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { harnessEventSchema, threadExportSchema } from "@pe/agent-contracts";

import type { HostLog } from "./host-log.ts";
import { artifactRelative, sha256Hex as sha, writeArtifact } from "./page-artifacts.ts";

const inside = (root: string, path: string) => {
  artifactRelative(root, realpathSync(path));
  return path;
};

/** The durable thread writer is synchronous. These reads occupy the same JS turn, so a live
 * append or metadata write cannot interleave. The captured tail may still be a running turn. */
export async function exportThread(root: string, threadId: string, hostLog: HostLog) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(threadId)) throw Error("Invalid thread export id");
  const store = realpathSync(root);
  const directory = inside(store, join(store, threadId));
  const sources = (["meta.json", "events.jsonl"] as const).map((path) => {
    const file = join(directory, path);
    let present = true;
    try {
      lstatSync(file);
    } catch (error) {
      if (path !== "events.jsonl" || (error as NodeJS.ErrnoException).code !== "ENOENT")
        throw error;
      present = false;
    }
    const bytes = present ? readFileSync(inside(realpathSync(directory), file)) : Buffer.alloc(0);
    return { path, present, sha256: sha(bytes), bytesBase64: bytes.toString("base64"), bytes };
  });
  const metadata: unknown = JSON.parse(sources[0]!.bytes.toString("utf8"));
  if (!metadata || typeof metadata !== "object" || !("id" in metadata) || metadata.id !== threadId)
    throw Error("Thread export metadata does not identify this thread");
  const log = sources[1]!.bytes.toString("utf8");
  if (log && !log.endsWith("\n")) throw Error("Thread export refuses an incomplete JSONL tail");
  const lines = log ? log.slice(0, -1).split("\n") : [];
  const events = lines.map((line, index) => {
    const event = harnessEventSchema.parse(JSON.parse(line));
    if (event.seq !== index + 1)
      throw Error("Thread export refuses a discontinuous event sequence");
    return event;
  });
  const archive = threadExportSchema.parse({
    schemaVersion: 1,
    kind: "pea-thread",
    capturedAt: new Date().toISOString(),
    threadId,
    lastSeq: events.at(-1)?.seq ?? 0,
    hostLog: {
      cursor: hostLog.last,
      ...hostLog.read(
        0,
        ({ event }) =>
          (event.kind === "thread" && event.thread === threadId) ||
          (event.kind === "oversize" && event.of === "thread" && event.ref.thread === threadId),
      ),
    },
    metadata,
    events,
    sources: sources.map(({ bytes: _bytes, ...source }) => source),
  });
  const content = JSON.stringify(archive, null, 2) + "\n";
  const sha256 = sha(content);
  await writeArtifact(store, join(store, ".exports", `${sha256}.json`), content);
  return new Response(content, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${threadId}-${sha256.slice(0, 12)}.json"`,
      "x-pe-export-sha256": sha256,
      "cache-control": "no-store",
    },
  });
}
