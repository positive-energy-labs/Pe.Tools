import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, workKey } from "@pe/agent-contracts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

// Driver defect (gate 7e350aba): the sidebar kept "Work partly read" after the only unreadable Work
// record was discarded. The cause was the host: a read that discards raises no workspace event, so
// the `thread-work` Reading was never read again. The notice file is the event.
// Mutant, run red once (2026-11-12): drop the `watchFile(storedNoticesPath(), …)` beside
// `work.subscribeUncaptured` in `pe-routes.ts`.
test("after a read discards the only unreadable Work record, the thread-work Reading says so", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-thread-work-discard-"));
  const key = bindWork("thread-work-discard", null);
  const name = createHash("sha256").update(`${key.route}:${workKey(key)}`).digest("hex") + ".json";
  const spec = {
    route: key.route,
    title: "Work",
    description: "Authored Work",
    schemaVersion: 2,
    schema: z.object({ note: z.string().default("") }),
  };
  const unread = (frame: unknown) =>
    ((frame as { value?: { observations?: string[] } }).value?.observations ?? []).filter(
      (line) => line.includes("could not be inspected"),
    );
  let release: (() => void) | undefined;
  try {
    await writeFile(join(dir, name), '{"format":"route-state-record-v2","targetKey":"x","value":{"trunc');
    const app = createPeRoutes({ store: fileRouteDocumentStore(stateFixture(dir)), registrations: [{ spec }] });
    const frames: unknown[] = [];
    release = app.observe({ kind: "thread-work" } as never, (frame: unknown) => frames.push(frame), null as never) ?? undefined;
    await expect.poll(() => frames.length, { timeout: 5_000 }).toBeGreaterThan(0);
    // The sentinel: the census does count the torn record.
    expect(unread(frames.at(-1))).toHaveLength(1);
    expect((await app.fetch(new Request(`http://host/pe/route-state/${key.route}`))).status).toBe(200);
    expect(await readdir(dir)).toEqual([]);
    await expect.poll(() => unread(frames.at(-1)), { timeout: 10_000, interval: 250 }).toEqual([]);
  } finally {
    release?.();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
