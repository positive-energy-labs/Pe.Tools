import { notices as storedNotices } from "@pe/host-contracts/kinds";
import { stateMachine, stateFixture } from "../../../tests/isolated-home/storage.ts";
import { dirname as storedParent } from "node:path";
import { mkdtempWork as mkdtemp } from "../../../tests/isolated-home/storage.ts";
/**
 * Kernel crusade 2, slice 1 (ST3): there is no Work migration. Stored Work that is not the route's
 * current shape is set aside with its exact bytes kept and one notice, and the route opens empty.
 *
 * Mutants. In `runtime/src/route-workspace.ts` `#decodeStored`, return
 * `{ raw, envelope: raw }` without `parseEnvelope` (old Work is then served, and no blob rests).
 * In `route-document-store.ts` `setState`, send a clear with no reason to
 * `rmSync(path, { force: true })` (a person's clear then keeps no bytes).
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { bindWork, workKey, ductsRouteState, fansRouteState } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { sha256Hex } from "@pe/host-contracts/kinds";

import { fileRouteDocumentStore } from "../src/route-document-store.ts";

const blobOf = (bytes: Uint8Array, path: string) => join(stateMachine(path).blobs, "sha256", sha256Hex(bytes));
const posted = (path: string) => storedNotices(stateMachine(path)).filter((n) => n.path === path);

for (const [spec, staged] of [
  [ductsRouteState, { labelParameter: { edit: { value: "Mark" } } }],
  [fansRouteState, { writeIntent: { edit: { value: { walk: { unitId: 42, portIndex: 0 } } } } }],
] as const) {
  test(`${spec.route} Work at the previous schemaVersion is set aside: the blob holds its exact bytes, one notice names the Place, and the route opens empty`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "pe-work-set-aside-"));
    const store = fileRouteDocumentStore(stateFixture(dir));
    const key = bindWork(spec.route, null), targetKey = workKey(key);
    const open = () => new RouteWorkspace({ store, registrations: [{ spec }] });
    try {
      await store.setState({
        targetKey,
        route: spec.route, value: {
        version: 1, schemaVersion: spec.schemaVersion - 1, revision: 7,
        doc: { ...spec.schema.parse({}), ...staged }, history: [],
      },
      });
      const path = join(dir, (await readdir(dir))[0]!);
      // Noncanonical whitespace distinguishes the original file from reserialized Work.
      const prior = Buffer.from(`\n  ${await readFile(path, "utf8")}\n`);
      await writeFile(path, prior);
      expect(await open().readUncaptured(key, spec.route)).toBeNull();
      expect(await readdir(dir)).toEqual([]);
      expect(await readFile(blobOf(prior, path))).toEqual(prior);
      expect(posted(path)).toMatchObject([
        {
          class: "discard",
        place: `Work for ${spec.route} (${targetKey})`,
          sha256: sha256Hex(prior),
          reason: expect.stringContaining(blobOf(prior, path)),
        },
      ]);
      expect(posted(path)[0]!.reason).toContain("schemaVersion");
      // A second open, and the census, post nothing new and still find no Work.
      expect((await open().instances()).works).toEqual([]);
      expect(await open().readUncaptured(key, spec.route)).toBeNull();
      expect(posted(path)).toHaveLength(1);
      // The route then starts fresh at the current stamp.
      const fresh = open();
      expect(await fresh.start(key, {}, "human")).toMatchObject({ ok: true });
      expect(await fresh.readUncaptured(key, spec.route)).toMatchObject({
        schemaVersion: spec.schemaVersion, revision: 1, doc: spec.schema.parse({}),
      });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test.each(["record", "envelope"])("unreadable Work %s keeps exact prior bytes in its notice's blob", async (kind) => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-discard-blob-"));
  const store = fileRouteDocumentStore(stateFixture(dir));
  const spec = ductsRouteState, key = bindWork(spec.route, null), targetKey = workKey(key);
  try {
    await store.setState({ targetKey, route: spec.route, value: { unreadable: true } });
    const path = join(dir, (await readdir(dir))[0]!);
    if (kind === "record") await writeFile(path, "  {broken JSON\n");
    const prior = await readFile(path);
    const workspace = new RouteWorkspace({ store, registrations: [{ spec }] });
    expect(await workspace.readUncaptured(key, spec.route)).toBeNull();
    expect(await store.getState({ targetKey, route: spec.route })).toBeNull();
    expect(await readFile(blobOf(prior, path))).toEqual(prior);
    expect(posted(path)).toMatchObject([
      { class: "discard", sha256: sha256Hex(prior), reason: expect.stringContaining(blobOf(prior, path)) },
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a person's clear goes through the one set-aside door: bytes kept, one notice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-clear-"));
  const store = fileRouteDocumentStore(stateFixture(dir));
  const spec = ductsRouteState, targetKey = workKey(bindWork(spec.route, null));
  try {
    await store.setState({ targetKey, route: spec.route, value: { mine: "work" } });
    const path = join(dir, (await readdir(dir))[0]!);
    const prior = await readFile(path);
    await store.setState({ targetKey, route: spec.route, value: null });
    expect(await readdir(dir)).toEqual([]);
    expect(await readFile(blobOf(prior, path))).toEqual(prior);
    expect(posted(path)).toMatchObject([{ class: "discard", sha256: sha256Hex(prior), reason: expect.stringContaining("Cleared.") }]);
    // Clearing what is not there is not an error.
    await store.setState({ targetKey, route: spec.route, value: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Windows has no portable way to deny one process a read of its own file; a folder at the Work
// address is the unreadable file every platform agrees on (EISDIR). The lock itself (EBUSY) is
// proven on the kernel in `host-contracts/tests/store.test.ts`.
test("Work that cannot be read is kept: it still exists, one notice posted, and the route opens empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-work-kept-"));
  const store = fileRouteDocumentStore(stateFixture(dir));
  const spec = ductsRouteState, key = bindWork(spec.route, null), targetKey = workKey(key);
  try {
    await store.setState({ targetKey, route: spec.route, value: { any: "value" } });
    const path = join(dir, (await readdir(dir))[0]!);
    await rm(path);
    await mkdir(path);
    await writeFile(join(path, "inside.txt"), "kept");
    const workspace = new RouteWorkspace({ store, registrations: [{ spec }] });
    expect(await workspace.readUncaptured(key, spec.route)).toBeNull();
    expect(await workspace.readUncaptured(key, spec.route)).toBeNull();
    expect(await readFile(join(path, "inside.txt"), "utf8")).toBe("kept");
    expect(posted(path)).toMatchObject([{ class: "keep", sha256: null }]);
    // No fresh Work lands over what was kept.
    await expect(workspace.start(key, {}, "human")).rejects.toThrow();
    expect(await readFile(join(path, "inside.txt"), "utf8")).toBe("kept");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
