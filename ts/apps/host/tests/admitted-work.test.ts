import { createHash } from "node:crypto";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { bindWork, workKey, type ReadingFrame, type ReadingRequest } from "@pe/agent-contracts";
import { builtinModule } from "../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
  createRouteAdmission,
  routeFingerprint,
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
  type BuiltinClosure,
} from "../../../packages/agent-contracts/src/route-module.ts";
import { workFingerprintSchema } from "../../../packages/agent-contracts/src/route-kernel-admission.ts";
import { registerAdmittedHostRoute } from "../src/pod-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

const roots: string[] = [];
const releases: (() => void)[] = [];
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
async function route(
  migrate?: (doc: unknown) => unknown,
  source: "builtin-closure" | "pod-bytes" = "builtin-closure",
  sourceBytes = "test",
) {
  const migrations: Record<string, string> = migrate ? { "1": "upgrade" } : {};
  const data = {
    ...builtinModule.data,
    work: {
      ...builtinModule.data.work,
      version: migrate ? 2 : 1,
      migrations,
    },
  };
  const module = {
    ...builtinModule,
    data,
    schemas: {
      ...builtinModule.schemas,
      work: z.object({ amount: z.number().default(0), note: z.string().default("") }),
    },
    bodies: {
      ...builtinModule.bodies,
      ...(migrate
        ? {
            upgrade: {
              kind: "migration",
              slot: "work.migrations.1",
              source: { module: "bodies.js", export: "upgrade" },
              run: migrate,
            },
          }
        : {}),
    },
  };
  const envelope: BuiltinClosure = {
    source: "builtin-closure",
    version: 1,
    data,
    variants: [{ client: "web", entry: "bodies.js" }],
    modules: [{ id: "bodies.js", sha256: createHash("sha256").update(sourceBytes).digest("hex") }],
    inputs: [],
    externals: [],
  };
  if (source === "pod-bytes") {
    const bytes = new TextEncoder().encode("export const source = 'verified pod witness';");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const artifact = {
      version: 1 as const,
      data,
      contracts: [{ id: "contracts", sha256: digest }],
      executables: [
        {
          client: "shared" as const,
          entry: "bodies.js",
          members: [{ path: "bodies.js", sha256: digest }],
        },
      ],
    };
    const port = await createRouteAdmission({
      loadedBindings: module,
      artifact,
      expectedFingerprint: await routeFingerprint(artifact),
      contracts: [{ id: "contracts", bytes }],
      executables: [
        {
          client: "shared",
          entry: "bodies.js",
          resolved: true,
          members: [{ path: "bodies.js", bytes }],
        },
      ],
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    });
    const admitted = port.admitUnknown({ ...module, artifact });
    if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
    return admitted.route;
  }
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    tiny: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const admitted = (await inventory.prepare("tiny", fingerprint)).admitUnknown(module);
  if (!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
  return admitted.route;
}
async function setup(
  migrate?: (doc: unknown) => unknown,
  gate?: Promise<void>,
  source: "builtin-closure" | "pod-bytes" = "builtin-closure",
) {
  const root = mkdtempSync(join(tmpdir(), "pe-u8m-"));
  roots.push(root);
  const disk = fileRouteDocumentStore(root);
  const store = {
    ...disk,
    listState: async () => {
      await gate;
      return disk.listState!();
    },
  };
  const key = bindWork("tiny", null);
  const saved = {
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: migrate ? { oldAmount: 3 } : { amount: 3, note: "kept" },
    history: [],
  };
  await store.setState({ targetKey: workKey(key), route: key.route, value: saved });
  const path = join(root, readdirSync(root)[0]!);
  const bytes = readFileSync(path, "utf8");
  const workspace = new RouteWorkspace({ registrations: [], store });
  const admitted = await route(migrate, source);
  const registration = registerAdmittedHostRoute(admitted, workspace);
  releases.push(registration.close);
  const admission = { routeKey: admitted.data.key, fingerprint: admitted.workFingerprint };
  const observe = observeResources(workspace, { observe: () => () => {} });
  const feed = (kind: "work" | "work-acks" = "work", fingerprint = admission.fingerprint) => {
    const frames: ReadingFrame[] = [];
    const request: ReadingRequest =
      kind === "work"
        ? { ...key, kind, admission: { ...admission, fingerprint } }
        : { kind, work: key, admission: { ...admission, fingerprint } };
    releases.push(observe(request, (frame) => frames.push(frame)));
    return frames;
  };
  return { workspace, store, key, admitted, registration, feed, path, bytes, saved, admission };
}
test("v1 persists as v2 before feed readiness; repeated browser opens and registration do not rerun migration", async () => {
  const migrate = vi.fn((doc: unknown) => ({
    amount: (doc as { oldAmount: number }).oldAmount + 1,
    note: "migrated",
  }));
  const f = await setup(migrate);
  const frames = f.feed();
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(frames[0]).toMatchObject({
    kind: "snapshot",
    value: { schemaVersion: 2, revision: 8, doc: { amount: 4, note: "migrated" } },
  });
  expect(JSON.parse(readFileSync(f.path, "utf8")).value).toMatchObject({
    schemaVersion: 2,
    revision: 8,
  });
  const second = f.feed();
  await vi.waitFor(() => expect(second).toHaveLength(1));
  await registerAdmittedHostRoute(f.admitted, f.workspace).ready;
  expect(migrate).toHaveBeenCalledOnce();
  // A second host instance proves the persisted schema age prevents migration on restart.
  const restarted = new RouteWorkspace({ registrations: [], store: f.store });
  const registered = registerAdmittedHostRoute(f.admitted, restarted);
  releases.push(registered.close);
  expect(await registered.ready).toBeNull();
  expect(migrate).toHaveBeenCalledOnce();
});
test("migration failure is terminal on both feeds and leaves v1 bytes exactly intact", async () => {
  const migrate = vi.fn((doc: unknown) => {
    (doc as { oldAmount: number }).oldAmount = 999;
    throw Error("broken upgrade");
  });
  const f = await setup(migrate);
  const snapshot = f.feed(),
    acks = f.feed("work-acks");
  await vi.waitFor(() => expect(snapshot).toHaveLength(1));
  expect(snapshot[0]).toMatchObject({
    kind: "failure",
    failure: {
      kind: "migration-failed",
      routeKey: "tiny",
      fromVersion: 1,
      toVersion: 2,
      step: 1,
      message: "broken upgrade",
    },
  });
  expect(acks[0]).toMatchObject({ kind: "failure", failure: { kind: "migration-failed" } });
  expect(readFileSync(f.path, "utf8")).toBe(f.bytes);
  const retry = f.feed();
  await vi.waitFor(() => expect(retry).toHaveLength(1));
  expect(migrate).toHaveBeenCalledOnce();
  expect(readFileSync(f.path, "utf8")).toBe(f.bytes);
});
test("a route with no migrations keeps its Work bytes and revision", async () => {
  const f = await setup();
  const frames = f.feed();
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(frames[0]).toMatchObject({
    kind: "snapshot",
    value: { schemaVersion: 1, revision: 7, doc: f.saved.doc },
  });
  expect(readFileSync(f.path, "utf8")).toBe(f.bytes);
});
test.each(["digest", "source"] as const)(
  "%s mismatch refuses both feeds before Work acquisition",
  async (part) => {
    const f = await setup();
    const fingerprint = workFingerprintSchema.parse(
      part === "digest"
        ? `builtin-closure:${"0".repeat(64)}`
        : f.admitted.workFingerprint.replace("builtin-closure:", "pod-bytes:"),
    );
    const snapshot = f.feed("work", fingerprint),
      acks = f.feed("work-acks", fingerprint);
    await vi.waitFor(() => expect(snapshot).toHaveLength(1));
    const failure = {
      kind: "registration-mismatch",
      routeKey: "tiny",
      expected: f.admitted.workFingerprint,
      received: fingerprint,
    };
    expect(snapshot[0]).toMatchObject({ kind: "failure", failure });
    expect(acks[0]).toMatchObject({ kind: "failure", failure });
    expect(readFileSync(f.path, "utf8")).toBe(f.bytes);
  },
);
test("host replacement terminates an existing feed and cannot revive it with the new Work", async () => {
  const f = await setup();
  const frames = f.feed();
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  const next = await route((doc) => doc);
  const replacement = registerAdmittedHostRoute(next, f.workspace);
  releases.push(replacement.close);
  await vi.waitFor(() => expect(frames).toHaveLength(2));
  expect(frames[1]).toMatchObject({
    kind: "failure",
    failure: {
      kind: "registration-mismatch",
      expected: next.workFingerprint,
      received: f.admitted.workFingerprint,
    },
  });
  await replacement.ready;
  expect(frames).toHaveLength(2);
});
test("missing fingerprint cannot bypass admission on an admitted Work route", async () => {
  const f = await setup();
  const frames: ReadingFrame[] = [];
  const observe = observeResources(f.workspace, { observe: () => () => {} });
  releases.push(observe({ ...f.key, kind: "work" }, (frame) => frames.push(frame)));
  expect(frames).toMatchObject([
    { kind: "failure", failure: { kind: "failed", code: "WorkAdmissionRequired" } },
  ]);
});
test("neither snapshot nor ack acquisition passes the host migration barrier", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const migrate = vi.fn(() => ({ amount: 4, note: "done" }));
  const f = await setup(migrate, gate);
  const frames = f.feed(),
    acks = f.feed("work-acks");
  expect(frames).toEqual([]);
  expect(acks).toEqual([]);
  expect(migrate).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(frames[0]).toMatchObject({ kind: "snapshot", value: { schemaVersion: 2, revision: 8 } });
  expect(migrate).toHaveBeenCalledOnce();
});
test("verified Pod-byte admission installs its exact migration bodies in the same host workspace", async () => {
  const f = await setup(() => ({ amount: 5, note: "Pod" }), undefined, "pod-bytes");
  expect(f.admitted.workFingerprint).toMatch(/^pod-bytes:/);
  const frames = f.feed();
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  expect(frames[0]).toMatchObject({
    kind: "snapshot",
    value: { schemaVersion: 2, revision: 8, doc: { amount: 5, note: "Pod" } },
  });
});
test("retirement during a disk census never runs the retired migration bodies", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oldMigration = vi.fn(() => ({ amount: 1, note: "old" }));
  const f = await setup(oldMigration, gate);
  const nextMigration = vi.fn(() => ({ amount: 2, note: "new" }));
  const next = await route(nextMigration, "builtin-closure", "next-build");
  const registration = registerAdmittedHostRoute(next, f.workspace);
  releases.push(registration.close);
  release();
  expect(await f.registration.ready).toMatchObject({
    kind: "failed",
    code: "WorkRegistrationRetired",
  });
  expect(await registration.ready).toBeNull();
  expect(oldMigration).not.toHaveBeenCalled();
  expect(nextMigration).toHaveBeenCalledOnce();
  expect(JSON.parse(readFileSync(f.path, "utf8")).value.doc).toEqual({ amount: 2, note: "new" });
});

test("a foreign route cannot reference another route's Work", async () => {
  const f = await setup();
  const module = { ...builtinModule, data: { ...builtinModule.data, key: "foreign", address: "/foreign", work: { ...builtinModule.data.work, route: "tiny" } } };
  const envelope: BuiltinClosure = { source: "builtin-closure", version: 1, data: module.data, variants: [{ client: "web", entry: "bodies.js" }], modules: [{ id: "bodies.js", sha256: "a".repeat(64) }], inputs: [], externals: [] };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({ foreign: { module, closure: { envelope, fingerprint }, catalog: [] } });
  expect((await inventory.prepare("foreign", fingerprint)).admitUnknown(module).ok).toBe(false);
  expect(f.admitted.data.work?.route).toBe("tiny");
});
