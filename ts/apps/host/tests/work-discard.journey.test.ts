import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { bindWork, workKey } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { createPeRoutes } from "../src/pe-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { human } from "./callers.ts";

test("D rule 5 opens discarded disk Work empty and saves the first edit without retaining old bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-discard-http-"));
  const key = bindWork("discard-journey", null), targetKey = workKey(key);
  const name = createHash("sha256").update(`${key.route}:${targetKey}`).digest("hex") + ".json";
  const path = join(dir, name), log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const spec = { route: key.route, title: "Work", description: "Authored Work", schemaVersion: 2,
    schema: z.object({ note: z.string().default("") }) };
  const store = fileRouteDocumentStore(dir);
  const request = (method: string, suffix = "", body?: unknown) => new Request(`http://host/pe/route-state/${key.route}${suffix}`, {
    method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  try {
    // The old stamp is rejected even when the document otherwise fits today's schema.
    const old = JSON.stringify({ format: "route-state-record-v2", targetKey, route: key.route,
      value: { version: 1, schemaVersion: 1, revision: 7, doc: { note: "OLD WORK MUST DISAPPEAR" }, history: [] } });
    for (const bytes of [old, "{UNDECODABLE WORK MUST DISAPPEAR"]) {
      await writeFile(path, bytes);
      const app = createPeRoutes({ store, registrations: [{ spec }] });
      const opened = await app.fetch(request("GET"));
      expect(opened.status).toBe(200);
      expect(await opened.json()).toMatchObject({ doc: { note: "" }, revision: 0 });
      expect(await readdir(dir), "opening discards the original, with no aside or archive").toEqual([]);
      const saved = await withInvocationContext({ caller: human }, () => app.fetch(request("POST", "/apply", {
        patches: [{ path: ["note"], value: "First edit" }], expectedRevision: 0, press: crypto.randomUUID(),
      })));
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ ok: true, revision: 1 });
      const reopened = createPeRoutes({ store, registrations: [{ spec }] });
      expect(await (await reopened.fetch(request("GET"))).json()).toMatchObject({ doc: { note: "First edit" }, revision: 1 });
      expect(await readdir(dir)).toEqual([name]);
      const persisted = await readFile(path, "utf8");
      expect(persisted).not.toContain("MUST DISAPPEAR");
      expect(JSON.parse(persisted)).toMatchObject({ value: { schemaVersion: 2, revision: 1, doc: { note: "First edit" } } });
      expect((await app.fetch(request("POST", "/start-fresh", {}))).status).toBe(404);
      expect((await app.fetch(request("GET", "/salvage"))).status).toBe(404);
    }
    expect(log).toHaveBeenCalledTimes(2);
    for (const [line] of log.mock.calls) {
      expect(line).toContain(path);
      expect(line).toMatch(/Discarded stored Work .*: .+/);
      expect(line).not.toMatch(/[\r\n]/);
    }
    // A failed disk access has a different boundary: it must not become empty Work.
    const io = createPeRoutes({ registrations: [{ spec }], store: { ...store,
      getState: async () => { throw Object.assign(Error("disk access denied"), { code: "EACCES" }); } } });
    const failed = await io.fetch(request("GET"));
    expect(failed.status).toBe(403);
    expect(await failed.json()).toMatchObject({ error: "disk access denied" });
    expect(await readdir(dir)).toEqual([name]);
    expect(log).toHaveBeenCalledTimes(2);
  } finally { log.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});
