import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, workKey } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

test("unreadable Work keeps its bytes; obsolete decoded Work is removed without conversion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-discard-"));
  const scope = bindWork("test", null);
  const key = { targetKey: workKey(scope), route: scope.route };
  const path = join(dir, createHash("sha256").update(`${key.route}:${key.targetKey}`).digest("hex") + ".json");
  try {
    const store = fileRouteDocumentStore(dir);
    for (const bytes of ["{broken", JSON.stringify({ ...key, format: "route-state-record-v1", value: { version: 1, revision: 4, doc: {} } })]) {
      await writeFile(path, bytes);
      await expect(store.getState(key)).rejects.toMatchObject({ code: "WorkUnreadable", key: key.targetKey });
      expect(await readFile(path, "utf8")).toBe(bytes);
      expect(await readdir(dir)).toEqual([path.split(/[\\/]/).at(-1)]);
    }
    await store.setState({ ...key, value: { version: 1, revision: 4, doc: { count: "old" } } });
    const workspace = new RouteWorkspace({ store, registrations: [{ spec: {
      route: scope.route, title: "Test", description: "Test", schema: z.object({ count: z.number().default(0) }),
      schemaVersion: 2, migrations: { 1: () => { throw Error("Conversion must never run"); } },
    } }] });
    expect(await workspace.read(scope, scope.route)).toBeNull();
    expect(await readdir(dir)).toEqual([]);
    expect(await workspace.apply(scope, scope.route, "human", [{ path: ["count"], value: 3 }], 4)).toMatchObject({ ok: false, code: "stale_revision" });
    expect(await workspace.apply(scope, scope.route, "human", [{ path: ["count"], value: 3 }], 0)).toMatchObject({ ok: true, revision: 1 });
    expect(await store.getState(key)).toMatchObject({ doc: { count: 3 }, history: [expect.objectContaining({ write: expect.objectContaining({ revision: 1 }) })] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a valid record at a foreign identity still refuses without deleting its bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-identity-"));
  const key = { targetKey: "test/target:", route: "test" };
  const path = join(dir, createHash("sha256").update(`${key.route}:${key.targetKey}`).digest("hex") + ".json");
  const bytes = JSON.stringify({ ...key, targetKey: "foreign/target:", format: "route-state-record-v2", value: { version: 1, revision: 0, doc: {} } });
  try {
    const store = fileRouteDocumentStore(dir);
    await writeFile(path, bytes);
    await expect(store.getState(key)).rejects.toThrow("Stored Work identity does not match its address");
    expect(await readFile(path, "utf8")).toBe(bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
