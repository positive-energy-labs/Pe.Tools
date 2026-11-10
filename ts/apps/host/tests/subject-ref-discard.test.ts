import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { bindWork, familiesRouteState, workKey } from "@pe/agent-contracts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

// ADR 0035 rule 2 with ADR 0033 rule 5: stored Work keyed in the old JSON-tuple spelling is refused
// at the one Work read door (route-workspace #load -> parseEnvelope) and deleted, never migrated.
test("stored Families Work in the old [family,type,parameter] spelling is discarded on read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-subject-ref-discard-"));
  const spec = { ...familiesRouteState, route: "subject-ref-discard" };
  const key = bindWork(spec.route, null), targetKey = workKey(key);
  const path = join(dir, `${createHash("sha256").update(`${key.route}:${targetKey}`).digest("hex")}.json`);
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const cell = { edit: { value: { value: "3", storageType: "String" } } };
  const stored = (cellKey: string) =>
    JSON.stringify({ format: "route-state-record-v2", targetKey, route: key.route,
      value: { version: 1, schemaVersion: 1, revision: 7,
        doc: { cells: { [cellKey]: cell } }, history: [] } });
  const open = async () =>
    (await createPeRoutes({ store: fileRouteDocumentStore(dir), registrations: [{ spec }] })
      .fetch(new Request(`http://host/pe/route-state/${key.route}`))).json() as Promise<{ doc: { cells: object }; revision: number }>;
  try {
    // The old spelling is refused and its bytes deleted; the Work opens empty.
    await writeFile(path, stored('["F","T","P"]'));
    expect(await open()).toMatchObject({ revision: 0, doc: { cells: {} } });
    expect(await readdir(dir)).toEqual([]);
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/Discarded stored Work .*SubjectRef/);
    // The canonical SubjectRef spelling is kept as written.
    await writeFile(path, stored('name:["F","T"]#field:P'));
    expect(await open()).toMatchObject({ revision: 7, doc: { cells: { 'name:["F","T"]#field:P': cell } } });
  } finally { log.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});
