import { createHash } from "node:crypto";
import { createPeRoutes } from "../src/pe-routes.ts";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { address, navigationSnapshotSchema, bindWork, workKey, ductsRouteState, fansRouteState } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { readStoredNotices, sha256Hex, writeHomeFile } from "@pe/host-contracts/store";
import { storedBlobsPath, storedNoticesPath } from "../src/notice-feed.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

vi.mock("@pe/host-contracts/store", async (original) => {
  const store = await original<typeof import("@pe/host-contracts/store")>();
  return { ...store, writeHomeFile: vi.fn(store.writeHomeFile) };
});

test("upgrade refuses concurrent Work changes and preserves the newer bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-upgrade-conflict-"));
  const store = fileRouteDocumentStore(dir);
  const spec = ductsRouteState;
  const key = bindWork(spec.route, null), targetKey = workKey(key);
  const workspace = new RouteWorkspace({ store, registrations: [{ spec }] });
  const actual = await vi.importActual<typeof import("@pe/host-contracts/store")>("@pe/host-contracts/store");
  try {
    await store.setState({ targetKey, route: spec.route, value: {
      version: 1, schemaVersion: 2, revision: 7,
      doc: { ...spec.schema.parse({}), designFriction: { edit: { value: 0.12 } } }, history: [],
    } });
    const path = join(dir, (await readdir(dir))[0]!);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.value.revision = 8;
    record.value.doc.designFriction.edit.value = 0.24;
    const newer = Buffer.from(`\n  ${JSON.stringify(record)}\n`);
    vi.mocked(writeHomeFile).mockImplementationOnce((file, bytes, options) => {
      expect(file).toBe(path);
      // Race after preservePrior reads its hash, before the real write door compares it.
      writeFileSync(path, newer);
      const saved = actual.writeHomeFile(file, bytes, options);
      expect(saved).toMatchObject({ ok: false, kind: "conflict" });
      return saved;
    });
    await expect(workspace.readUncaptured(key, spec.route)).rejects.toThrow(
      "Work changed before its schema upgrade",
    );
    expect(await readFile(path)).toEqual(newer);
  } finally {
    vi.mocked(writeHomeFile).mockReset().mockImplementation(actual.writeHomeFile);
    await rm(dir, { recursive: true, force: true });
  }
});

for (const [spec, previous, removed, staged, dropped] of [
  [ductsRouteState, 2, "designFriction", { labelParameter: { edit: { value: "Mark" } } }, { edit: { value: 0.12 } }],
  [fansRouteState, 1, "parameters", { writeIntent: { edit: { value: { walk: { unitId: 42, portIndex: 0 } } } } }, { fanFlow: { edit: { value: "Design Flow" } } }],
] as const) {
  test(`${spec.route} accepted replay upgrades history before any load`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "pe-work-replay-upgrade-"));
    const store = fileRouteDocumentStore(dir);
    const key = bindWork(spec.route, null), targetKey = workKey(key);
    const workspace = new RouteWorkspace({ store, registrations: [{ spec }] });
    const doc = { ...spec.schema.parse({}), ...staged, [removed]: dropped };
    let stop = () => {};
    try {
      await store.setState({ targetKey, route: spec.route, value: {
        version: 1, schemaVersion: previous, revision: 7, doc,
        history: [{ write: {
          key, kind: "apply", by: "human", press: "old-edit", step: "old-edit",
          base: 6, revision: 7, undoable: true, at: Date.now(),
          patches: [{ path: [removed], value: dropped }],
          inverse: [{ path: [removed], value: null }],
        }, after: doc }],
      } });
      // No read/view/load before subscription: its callback must already see upgraded history.
      const saved = await new Promise<unknown>((resolve, reject) => {
        stop = workspace.observeAccepted(key, (ack) => {
          expect(ack).toMatchObject({ revision: 7, replay: true });
          void store.getState({ targetKey, route: spec.route }).then(resolve, reject);
        }, reject);
      });
      expect(saved).not.toHaveProperty(`history.0.after.${removed}`);
      expect(saved).toMatchObject({ schemaVersion: spec.schemaVersion, history: [{ after: staged }] });
    } finally {
      stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.each([false, true])(`${spec.route} upgrades pre-h2 Work and notices non-empty settings: %s`, async (nonempty) => {
    const dir = await mkdtemp(join(tmpdir(), "pe-work-upgrade-"));
    const store = fileRouteDocumentStore(dir);
    const key = bindWork(spec.route, null), targetKey = workKey(key);
    const read = () => new RouteWorkspace({ store, registrations: [{ spec }] }).readUncaptured(key, spec.route);
    const before = readStoredNotices(storedNoticesPath());
    try {
      await store.setState({ targetKey, route: spec.route, value: {
        version: 1, schemaVersion: previous, revision: 7,
        doc: { ...spec.schema.parse({}), ...staged, [removed]: nonempty ? dropped :
          spec.route === "fans" ? { fanFlow: { edit: null }, terminalFlow: { edit: null } } : { edit: null } }, history: [],
      } });
      const path = join(dir, (await readdir(dir))[0]!);
      // Noncanonical whitespace distinguishes the original file from reserialized Work.
      const prior = Buffer.from(`\n  ${await readFile(path, "utf8")}\n`);
      await writeFile(path, prior);
      expect((await new RouteWorkspace({ store, registrations: [{ spec }] }).instances()).works).toHaveLength(1);
      expect(await read()).toMatchObject({ revision: 7, schemaVersion: previous + 1, doc: staged });
      const blob = join(storedBlobsPath(), "sha256", sha256Hex(prior));
      expect(await readFile(blob)).toEqual(prior);
      const saved = await store.getState({ targetKey, route: spec.route });
      expect(saved).toMatchObject({ schemaVersion: previous + 1, revision: 7, doc: staged });
      expect((saved as { doc: unknown }).doc).not.toHaveProperty(removed);
      await read();
      const notices = readStoredNotices(storedNoticesPath()).slice(before.length);
      expect(notices).toHaveLength(nonempty ? 1 : 0);
      if (nonempty) {
        expect(notices[0]!.sha256).toBe(sha256Hex(prior));
        expect(notices[0]!.reason).toContain(blob);
        expect(notices[0]!.reason).toContain(removed);
        expect(notices[0]!.reason).toContain(JSON.stringify(dropped));
        expect(notices[0]!.reason).toContain("settings at the project or firm tier");
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test("ducts v1 is discarded rather than upgraded as pre-h2 Work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-upgrade-old-"));
  const store = fileRouteDocumentStore(dir);
  const spec = ductsRouteState;
  const key = bindWork(spec.route, null), targetKey = workKey(key);
  const workspace = new RouteWorkspace({ store, registrations: [{ spec }] });
  const before = readStoredNotices(storedNoticesPath());
  try {
    await store.setState({ targetKey, route: spec.route, value: {
      version: 1, schemaVersion: 1, revision: 7,
      doc: { ...spec.schema.parse({}), labelParameter: { edit: { value: "Mark" } },
        designFriction: { edit: { value: 0.12 } } }, history: [],
    } });
    expect(await workspace.readUncaptured(key, spec.route)).toBeNull();
    expect(await store.getState({ targetKey, route: spec.route })).toBeNull();
    expect(readStoredNotices(storedNoticesPath()).slice(before.length)).toMatchObject([
      { class: "discard", reason: expect.stringContaining("schemaVersion") },
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("upgrade strips obsolete history snapshots and refuses undo without losing other edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-upgrade-history-"));
  const store = fileRouteDocumentStore(dir);
  const spec = ductsRouteState;
  const key = bindWork(spec.route, null), targetKey = workKey(key);
  const workspace = new RouteWorkspace({ store, registrations: [{ spec }] });
  const staged = { labelParameter: { edit: { value: "Mark" } } };
  const doc = { ...spec.schema.parse({}), ...staged, designFriction: { edit: { value: 0.12 } } };
  try {
    await store.setState({ targetKey, route: spec.route, value: {
      version: 1, schemaVersion: 2, revision: 7, doc,
      history: [{ write: {
        key, kind: "apply", by: "human", press: "friction-edit", step: "friction-edit",
        base: 6, revision: 7, undoable: true,
        patches: [{ path: ["designFriction", "edit"], value: { value: 0.12 } }],
        inverse: [{ path: ["designFriction", "edit"], value: null }],
      }, after: doc }],
    } });
    const upgraded = await workspace.readUncaptured(key, spec.route);
    expect(upgraded).toMatchObject({ revision: 7, doc: staged });
    const saved = await store.getState({ targetKey, route: spec.route });
    expect(saved).toMatchObject({ history: [{ after: staged }] });
    expect(saved).not.toHaveProperty("history.0.after.designFriction");
    // The public undo door must refuse the obsolete patch, without throwing or changing Work.
    await expect(workspace.step(key, spec.route, "human", "undo", 7)).resolves.toMatchObject({
      ok: false, kind: "refused",
    });
    expect(await workspace.readUncaptured(key, spec.route)).toEqual(upgraded);
    expect(await store.getState({ targetKey, route: spec.route })).toEqual(saved);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Driver gate-ab5b9d5f/w4: exact pre-h2 records, with only their document address rebound.
test.each(["navigation", "instances", "raw", "read", "view"] as const)("%s upgrades the driver's pre-h2 Work without losing cells", async (door) => {
  const dir = await mkdtemp(join(tmpdir(), "pe-census-upgrade-"));
  const store = fileRouteDocumentStore(dir);
  const registrations = [ductsRouteState, fansRouteState].map(spec => ({ spec }));
  const app = createPeRoutes({ registrations, store, heads: { observe: () => () => {} },
    navigation: { threads: async () => [], documents: async () => [] } });
  const before = readStoredNotices(storedNoticesPath());
  try {
    const planted = [];
    for (const spec of [ductsRouteState, fansRouteState]) {
      const fixture = JSON.parse(await readFile(new URL(`./fixtures/pre-h2-work/planted-${spec.route}.json`, import.meta.url), "utf8"));
      const key = bindWork(spec.route, address("C:\\Models\\Census.rvt"));
      const targetKey = workKey(key);
      const record = JSON.parse(JSON.stringify(fixture).replaceAll(JSON.stringify(fixture.value.history[0].write.key.target).slice(1, -1), JSON.stringify(key.target).slice(1, -1)));
      record.targetKey = targetKey;
      const path = join(dir, `${createHash("sha256").update(`${spec.route}:${targetKey}`).digest("hex")}.json`);
      const prior = Buffer.from(JSON.stringify(record));
      await writeFile(path, prior);
      planted.push({ spec, key, targetKey, path, prior, record });
    }
    const read = async () => navigationSnapshotSchema.parse(await (await app.fetch(new Request("http://host/pe/navigation"))).json());
    const workspace = new RouteWorkspace({ store, registrations });
    if (door === "instances") expect((await workspace.instances()).works).toHaveLength(2);
    if (door === "raw" || door === "read" || door === "view") {
      for (const { spec, key, record } of planted) {
        const saved = await (door === "raw" ? workspace.readRaw(key, spec.route) :
          door === "read" ? workspace.read(key, spec.route) : workspace.view(key, spec.route));
        const { designFriction: _, parameters: __, claims: ___, ...cells } = record.value.doc;
        expect(saved).toMatchObject({ doc: spec.schema.parse(cells), revision: record.value.revision });
        expect(spec.schema.safeParse(saved?.doc).success).toBe(true);
      }
    }
    expect((await read()).works, JSON.stringify(readStoredNotices(storedNoticesPath()).slice(before.length))).toHaveLength(2);
    for (const { spec, key, targetKey, path, prior, record } of planted) {
      const saved = await store.getState({ targetKey, route: spec.route });
      expect(saved).toMatchObject({ schemaVersion: spec.schemaVersion, revision: record.value.revision });
      const { designFriction: _, parameters: __, claims: ___, ...cells } = record.value.doc;
      const doc = spec.schema.parse(cells);
      expect(saved).toHaveProperty("doc", doc);
      expect(JSON.parse(await readFile(path, "utf8")).value).toEqual(saved);
      expect(await readFile(join(storedBlobsPath(), "sha256", sha256Hex(prior)))).toEqual(prior);
      expect(await new RouteWorkspace({ store, registrations }).readUncaptured(key, spec.route)).toMatchObject({ doc });
    }
    await read();
    expect(readStoredNotices(storedNoticesPath()).slice(before.length)).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test.each(["record", "envelope"])("unreadable Work %s keeps exact prior bytes in its notice's blob", async (kind) => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-discard-blob-"));
  const store = fileRouteDocumentStore(dir);
  const spec = ductsRouteState, key = bindWork(spec.route, null), targetKey = workKey(key);
  const before = readStoredNotices(storedNoticesPath());
  try {
    await store.setState({ targetKey, route: spec.route, value: { unreadable: true } });
    const path = join(dir, (await readdir(dir))[0]!);
    if (kind === "record") await writeFile(path, "  {broken JSON\n");
    const prior = await readFile(path);
    const workspace = new RouteWorkspace({ store, registrations: [{ spec }] });
    expect(await workspace.readUncaptured(key, spec.route)).toBeNull();
    expect(await store.getState({ targetKey, route: spec.route })).toBeNull();
    const blob = join(storedBlobsPath(), "sha256", sha256Hex(prior));
    expect(await readFile(blob)).toEqual(prior);
    const notices = readStoredNotices(storedNoticesPath()).slice(before.length);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ class: "discard", sha256: sha256Hex(prior), reason: expect.stringContaining(blob) });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
