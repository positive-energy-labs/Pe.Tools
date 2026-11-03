import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { bindWork, workKey, type ReadingFrame, type ReadingRequest } from "@pe/agent-contracts";
import { builtinModule } from "../../../packages/agent-contracts/src/route-kernel.fixtures.ts";
import {
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
async function route(migrate?: (doc: unknown) => unknown) {
  const data = {
    ...builtinModule.data,
    work: {
      ...builtinModule.data.work,
      version: migrate ? 2 : 1,
      migrations: migrate ? { "1": "upgrade" } : {},
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
    hostVersion: "test",
    variants: [{ client: "web", entry: "bodies.js" }],
    modules: [{ id: "bodies.js", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
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
async function setup(migrate?: (doc: unknown) => unknown) {
  const root = mkdtempSync(join(tmpdir(), "pe-u8m-"));
  roots.push(root);
  const store = fileRouteDocumentStore(root);
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
  const admitted = await route(migrate);
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
