/**
 * Kinds (routes CONTRACTS K-A2; kernel crusade 2, slice 1 / ST4a): `Kind.in(root, ...args)` is the
 * only way to a stored file, and the kind carries what preserves its bytes.
 *
 * The witness at the bottom is typechecked, not run: each `@ts-expect-error` line must fail to
 * compile. Mutant that turns `tsc` red on it ("Unused '@ts-expect-error' directive"): in
 * `src/kinds.ts`, widen `read` to take `StoredFile<T, At> | string`, or drop `[where]` from
 * `StatePath` and `HomePath`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { stateTree } from "../src/service-identity.ts";
import {
  appendLine,
  derivedIn,
  derivedKey,
  homeKind,
  keptStateKind,
  notices,
  read,
  readDerivedIn,
  readLines,
  refuseDerived,
  rest,
  rested,
  setAside,
  sha256Hex,
  stateKind,
  stateLog,
  writeDerivedIn,
  writeHome,
  writeState,
  type StatePath,
  type DerivedDir,
  type Stored,
} from "../src/kinds.ts";

const schema = z.strictObject({ name: z.string() });
/** A kind declares a place, a schema and segments, and nothing about notices or blobs. */
const taskKind = stateKind({
  place: (id: string) => `Task ${id}`,
  schema,
  segments: (id: string) => ["tasks", `${id}.json`],
});
const trustKind = keptStateKind({
  place: () => "Route trust",
  schema,
  segments: () => ["route-trust.json"],
});
const settingsKind = homeKind({
  place: (owner: string) => `Settings for ${owner}`,
  schema,
  segments: (owner: string) => ["Settings", `${owner}.json`],
});
const eventsLog = stateLog({ place: () => "Events", schema, segments: () => ["events.jsonl"] });

let root: string;
let machine: ReturnType<typeof stateTree>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-kinds-"));
  machine = stateTree(join(root, "machine"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const blob = (bytes: string) => join(machine.blobs, "sha256", sha256Hex(bytes));

test("a kind mints its own path under its root, and refuses a segment that would leave it", () => {
  expect(taskKind.in(machine, "a").path).toBe(join(root, "machine", "state", "tasks", "a.json"));
  const home = machine.home({ tier: "project", root: join(root, "Project", "Pe.Tools") });
  expect(settingsKind.in(home, "ducts").path).toBe(join(root, "Project", "Pe.Tools", "Settings", "ducts.json"));
  expect(taskKind.in(machine, "a").place).toBe("Task a");
  for (const id of ["..", "../../escape", "a\\b", ""])
    expect(() => stateKind({ place: () => "x", schema, segments: () => [id] }).in(machine)).toThrow(/segment/);
});

// Mutant: in `policyOf`, drop `blobRoot: file.machine.blobs` and, in `refuse`, send a discard with
// no `blobRoot` straight to `rmSync` (the code before ST1): the bytes are gone and no blob rests.
test("a state kind that names no blob root still keeps the bytes it sets aside", () => {
  const file = taskKind.in(machine, "a");
  writeState(file, '{"name":"a"}');
  expect(read(file)).toMatchObject({ kind: "ok", value: { name: "a" } });
  writeState(file, "{ torn");
  const result: Stored<{ name: string }> = read(file);
  expect(result).toMatchObject({ kind: "set-aside", blob: blob("{ torn") });
  expect(existsSync(file.path)).toBe(false);
  expect(readFileSync(blob("{ torn"), "utf8")).toBe("{ torn");
  expect(notices(machine)).toMatchObject([
    { class: "discard", place: "Task a", path: file.path, sha256: sha256Hex("{ torn") },
  ]);
  expect(read(file)).toEqual({ kind: "missing" });
  // An owner's refusal (another epoch, a person's clear) goes through the same door.
  writeState(file, '{"name":"stale"}');
  expect(setAside(file, "another epoch")).toMatchObject({
    kind: "set-aside",
    blob: blob('{"name":"stale"}'),
  });
  expect(setAside(file, "another epoch")).toEqual({ kind: "missing" });
  expect(notices(machine)).toHaveLength(2);
});

test("a kept-state kind and a home kind are never set aside", () => {
  const trust = trustKind.in(machine);
  writeState(trust, "{ torn");
  expect(read(trust)).toMatchObject({ kind: "kept" });
  expect(readFileSync(trust.path, "utf8")).toBe("{ torn");

  const home = machine.home({ tier: "firm", root: join(root, "Firm") });
  const settings = settingsKind.in(home, "ducts");
  expect(writeHome(settings, "{ torn", null)).toMatchObject({ ok: true, priorSha256: null });
  expect(read(settings)).toMatchObject({ kind: "kept" });
  expect(readFileSync(settings.path, "utf8")).toBe("{ torn");
  // The home write door compares, and rests what it replaces in this machine's blob store.
  expect(writeHome(settings, '{"name":"a"}', sha256Hex("other"))).toMatchObject({
    ok: false,
    kind: "conflict",
  });
  expect(writeHome(settings, '{"name":"a"}', sha256Hex("{ torn"))).toMatchObject({
    ok: true,
    priorBlob: blob("{ torn"),
  });
  expect(read(settings)).toMatchObject({ kind: "ok", value: { name: "a" } });
  expect(notices(machine).map((n) => n.class)).toEqual(["keep", "keep"]);
});

test("a state log decodes per line, and a derived folder is read and written by its minted dir", () => {
  const log = eventsLog.in(machine);
  expect(readLines(log)).toEqual({ kind: "missing" });
  appendLine(log, { name: "a" });
  writeFileSync(log.path, "{ torn", { flag: "a" });
  appendLine(log, { name: "b" });
  expect(readLines(log)).toEqual({
    kind: "ok",
    values: [{ name: "a" }, { name: "b" }],
    skipped: 1,
  });

  const key = derivedKey("source", "producer/1");
  const here = derivedIn(machine);
  const shared = derivedIn(machine.home({ tier: "project", root: join(root, "Project") }));
  expect(shared.path).toBe(join(root, "Project", "Derived"));
  const directories: DerivedDir[] = [here, shared];
  for (const dir of directories) {
    expect(readDerivedIn(dir, key)).toBeNull();
    const written = writeDerivedIn(dir, key, "pages");
    expect(readDerivedIn(dir, key)).toMatchObject({ path: written.path });
    refuseDerived(dir, written, "does not decode");
  }
  // In machine state a refused derived file is set aside; in a home it is kept for its writer.
  expect(readDerivedIn(here, key)).toBeNull();
  expect(readFileSync(blob("pages"), "utf8")).toBe("pages");
  expect(readDerivedIn(shared, key)?.bytes.toString()).toBe("pages");
});

test("the blob store has one writer, and reads back only bytes that match their hash", () => {
  const { sha256, blob: path } = rest(machine, "bytes");
  expect(path).toBe(blob("bytes"));
  expect(rested(machine, sha256)).toEqual({ kind: "ok", bytes: Buffer.from("bytes") });
  writeFileSync(path, "tampered");
  expect(rested(machine, sha256)).toEqual({ kind: "corrupt" });
  expect(rested(machine, "../../etc")).toEqual({ kind: "corrupt" });
});

test("a caller without a keep check cannot overwrite a decision without preserving its bytes", () => {
  const file = trustKind.in(machine);
  const prior = "{ unreadable decision";
  writeState(file, prior);
  read(file);
  writeState(file, JSON.stringify({ name: "replacement" }));
  expect(rested(machine, sha256Hex(prior))).toEqual({ kind: "ok", bytes: Buffer.from(prior) });
});

/** Typechecked only: never called. */
export function witness(bare: string) {
  const home = machine.home({ tier: "user", root: bare });
  const state = taskKind.in(machine, "a");
  const authored = settingsKind.in(home, "ducts");
  // @ts-expect-error a bare string is not a stored file
  read(bare);
  // @ts-expect-error a home path cannot be passed to the reader as a file
  read(authored.path);
  // @ts-expect-error a state kind cannot read a file carrying a HomePath
  read({ ...state, path: authored.path });
  // @ts-expect-error a bare string is not a state root
  taskKind.in(bare, "a");
  // @ts-expect-error a bare `Home` is not bound to a machine
  settingsKind.in({ tier: "user", root: bare }, "ducts");
  // @ts-expect-error a state kind takes the state root, never a home
  taskKind.in(home, "a");
  // @ts-expect-error a home kind takes a home, never the state root
  settingsKind.in(machine, "ducts");
  // @ts-expect-error a home file never reaches the state writer
  writeState(authored, "{}");
  // @ts-expect-error a state file never reaches the home write door
  writeHome(state, "{}", null);
  // @ts-expect-error a home file is never set aside
  setAside(authored, "stale");
  // @ts-expect-error a kept-state file is never set aside
  setAside(trustKind.in(machine), "stale");
  // @ts-expect-error a kind and a separately made path cannot be paired by hand
  read({ ...state, path: bare });
  // @ts-expect-error a home path is not a state path
  const path: StatePath = authored.path;
  // @ts-expect-error a home read never answers `set-aside`
  const aside: { kind: "set-aside" } = read(authored);
  return [path, aside];
}
