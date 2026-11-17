import { subjectCode } from "@pe/agent-contracts/subject-ref";
import { z } from "zod";
import { RouteWorkspace } from "@pe/runtime";
import { draftCellSchema, bindWork, workKey } from "@pe/agent-contracts";
import { findingsWork } from "@pe/agent-contracts/slots";
import { stateFixture, stateMachine } from "../../../tests/isolated-home/storage.ts";
import { mkdtempSync } from "../../../tests/isolated-home/storage.ts";
import { expect, test, vi } from "vite-plus/test";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { ductsRouteState } from "@pe/duct-systems-contract/ducts";
import { Effect, Layer } from "effect";
import { effectTest } from "./effect-test.ts";
import { admittedBuiltinsLayer } from "../src/admitted-builtins.ts";
import { builtinEnrollments } from "../src/builtin-enrollment.ts";

const interleave = vi.hoisted(() => ({ afterWrite: null as (() => void) | null, failRename: false }));
vi.mock("node:fs", async (load) => {
  const real = await load<typeof import("node:fs")>();
  return {
    ...real,
    writeFileSync: (...args: Parameters<typeof real.writeFileSync>) => {
      real.writeFileSync(...args);
      const next = interleave.afterWrite;
      interleave.afterWrite = null;
      next?.();
    },
    renameSync: (...args: Parameters<typeof real.renameSync>) => {
      if (interleave.failRename) throw Object.assign(new Error("EBUSY: share locked"), { code: "EBUSY" });
      real.renameSync(...args);
    },
  };
});

test("startup retires old ducts Work, preserves exact bytes and emits one notice across restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-retired-work-"));
  try {
    const store = fileRouteDocumentStore(stateFixture(dir));
    // The new address's hash cannot find this record. Its value deliberately has no current shape.
    await store.setState({ targetKey: "old-address", route: "ducts", value: { old: "keep every byte" } });
    await store.setState({ targetKey: "current-address", route: "duct-systems", value: { current: true } });
    const bytes = readdirSync(dir).map(file => readFileSync(join(dir, file)))
      .find(bytes => JSON.parse(bytes.toString()).route === "ducts")!;
    await new RouteWorkspace({ registrations: [{ spec: ductsRouteState }], store }).ready;
    expect(await store.getState({ targetKey: "old-address", route: "ducts" })).toBeNull();
    expect(await store.getState({ targetKey: "current-address", route: "duct-systems" })).toEqual({ current: true });
    const machine = stateMachine(dir);
    const notices = readFileSync(machine.notices, "utf8");
    expect(notices.trim().split("\n")).toHaveLength(1);
    expect(notices).toContain("retired");
    expect(readdirSync(machine.blobs, { recursive: true }).map(String).some(file => {
      try { return readFileSync(join(machine.blobs, file)).equals(bytes); } catch { return false; }
    })).toBe(true);
    await new RouteWorkspace({ registrations: [{ spec: ductsRouteState }],
      store: fileRouteDocumentStore(stateFixture(dir)) }).ready;
    expect(readFileSync(machine.notices, "utf8")).toBe(notices);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("startup keeps an unreadable old Work record instead of deleting it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-retired-unreadable-"));
  try {
    const store = fileRouteDocumentStore(stateFixture(dir));
    await store.setState({ targetKey: "old", route: "ducts", value: { important: true } });
    const path = join(dir, readdirSync(dir)[0]!);
    const bytes = Buffer.from('{"format":"route-state-record-v2","route":"ducts",');
    writeFileSync(path, bytes);
    await new RouteWorkspace({ registrations: [{ spec: ductsRouteState }], store }).ready;
    expect(readFileSync(path)).toEqual(bytes);
    expect(readdirSync(dir)).toHaveLength(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("startup keeps retired Work when preservation fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-retired-kept-"));
  try {
    const store = fileRouteDocumentStore(stateFixture(dir));
    await store.setState({ targetKey: "old", route: "ducts", value: { important: true } });
    const path = join(dir, readdirSync(dir)[0]!);
    const bytes = readFileSync(path);
    writeFileSync(stateMachine(dir).blobs, "blocks preservation");
    await expect(new RouteWorkspace({ registrations: [{ spec: ductsRouteState }], store }).ready)
      .rejects.toMatchObject({ kind: "kept" });
    expect(readFileSync(path)).toEqual(bytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

effectTest("admitted startup retires old Work when product registration is deferred", () => Effect.gen(function* () {
  const dir = mkdtempSync(join(tmpdir(), "pe-retired-admitted-"));
  yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(dir, { recursive: true, force: true })));
  const store = fileRouteDocumentStore(stateFixture(dir));
  yield* Effect.promise(() => store.setState({ targetKey: "old", route: "ducts", value: { old: true } }));
  // The real host excludes builtins from constructor registration, then admits their captured contract.
  const workspace = new RouteWorkspace({ registrations: [], store });
  yield* Layer.build(admittedBuiltinsLayer(workspace,
    builtinEnrollments.filter(entry => entry.routeKey === "duct-systems")));
  expect(workspace.settingsOwners([bindWork("duct-systems", null)])).toEqual(["ducts"]);
  expect(workspace.settingsOwners([bindWork("ducts", null)])).toEqual([]);
  expect(yield* Effect.promise(() => store.getState({ targetKey: "old", route: "ducts" }))).toBeNull();
  expect(readFileSync(stateMachine(dir).notices, "utf8").trim().split("\n")).toHaveLength(1);
}));

test("a clear reports kept when the prior bytes cannot be copied aside", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-work-clear-kept-"));
  const store = fileRouteDocumentStore(stateFixture(dir));
  const key = { targetKey: "clear-kept", route: "fans" };
  await store.setState({ ...key, value: { important: "keep me" } });
  writeFileSync(stateMachine(dir).blobs, "blocks the copy");
  await expect(store.setState({ ...key, value: null })).rejects.toMatchObject({ kind: "kept" });
  expect(await store.getState(key)).toEqual({ important: "keep me" });
});

test("two interleaved Work writers publish complete records without sharing staging files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-work-writers-"));
  try {
    const first = fileRouteDocumentStore(stateFixture(dir));
    const second = fileRouteDocumentStore(stateFixture(dir));
    const address = { targetKey: "same-work", route: "fans" };
    const value = { author: "first", body: "a".repeat(4096) };
    let competing: Promise<void> | undefined;
    // Finish another machine's write after the first stages bytes, before its rename.
    interleave.afterWrite = () => {
      competing = second.setState({
        ...address,
        value: { author: "second", body: "b".repeat(4096) },
      });
    };
    const writing = first.setState({ ...address, value });
    expect(competing).toBeDefined();
    await Promise.all([writing, competing]);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, files[0]!), "utf8")).value).toEqual(value);
    expect(await first.getState(address)).toEqual(value);
  } finally {
    interleave.afterWrite = null;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed Work publish removes its own staging file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-work-failed-"));
  try {
    const store = fileRouteDocumentStore(stateFixture(dir));
    interleave.failRename = true;
    await expect(store.setState({ targetKey: "w", route: "fans", value: { a: 1 } })).rejects.toThrow("EBUSY");
    expect(readdirSync(dir)).toEqual([]);
  } finally {
    interleave.failRename = false;
    rmSync(dir, { recursive: true, force: true });
  }
});


test("untrusted authors set stored Work aside once and retain its exact bytes", async () => {
  for (const by of ["unknown", "person", undefined]) {
    for (const spec of [
      { route: "stamp-test", title: "Stamp", description: "Stamp", schema: z.object({ cell: draftCellSchema(z.number()) }) },
      findingsWork,
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "pe-stamp-aside-"));
      const store = fileRouteDocumentStore(stateFixture(dir));
      const key = bindWork(spec.route, null);
      const doc = spec.route === "findings"
        ? { findings: { n: { id: "n", kind: "note", subject: subjectCode({ keyKind: "name", key: ["stamp"] }), text: "note", said: { by, at: new Date().toISOString() } } } }
        : { cell: { edit: { value: 1, by } } };
      await store.setState({ targetKey: workKey(key), route: spec.route, value: { version: 1, schemaVersion: spec.route === "findings" ? 2 : 1, revision: 1, doc } });
      const bytes = readFileSync(join(dir, readdirSync(dir)[0]!));
      const workspace = new RouteWorkspace({ registrations: [{ spec }], store });
      // P-040: retain an invalid cell marker and revision, while setting its original bytes aside.
      const revision = spec.route === "stamp-test" ? 1 : 0;
      const first = await workspace.view(key, spec.route);
      expect(first?.revision ?? 0).toBe(revision);
      expect((await workspace.view(key, spec.route))?.revision ?? 0).toBe(revision);
      if (spec.route === "stamp-test") {
        expect(first?.doc).toMatchObject({ cell: { invalid: expect.any(String) } });
        expect(first?.doc).not.toHaveProperty("cell.edit");
      } else expect(readdirSync(dir)).toEqual([]);
      const machine = stateMachine(dir);
      expect(readFileSync(machine.notices, "utf8").trim().split("\n")).toHaveLength(1);
      const blobs = readdirSync(machine.blobs, { recursive: true }).map(String);
      expect(blobs.some(file => { try { return readFileSync(join(machine.blobs, file)).equals(bytes); } catch { return false; } })).toBe(true);
    }
  }
});
