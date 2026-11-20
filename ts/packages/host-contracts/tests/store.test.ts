import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { stateTree } from "../src/service-identity.ts";
import {
  appendLine,
  derivedIn,
  homeKind,
  notices,
  read,
  readDerivedIn,
  readLines,
  setAside,
  sha256Hex,
  stateKind,
  stateLog,
  writeDerivedIn,
  writeHome,
  writeState,
} from "../src/kinds.ts";
import { derivedName } from "../src/store.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: vi.fn(fs.readFileSync),
    renameSync: vi.fn(fs.renameSync),
    writeFileSync: vi.fn(fs.writeFileSync),
  };
});
const schema = z.strictObject({ name: z.string() });
const valueKind = stateKind({
  schema,
  place: (_name: string) => "Work for /pipes",
  segments: (name: string) => [name],
});
const textKind = stateKind({
  schema: z.string(),
  parse: (text) => text,
  place: (_name: string) => "State",
  segments: (name: string) => [name],
});
const authoredKind = homeKind({
  schema,
  place: () => "Pod a",
  segments: () => ["Pods", "a", "pod.json"],
});
const eventsKind = stateLog({
  schema: z.strictObject({ id: z.number() }),
  place: () => "Capture receipts",
  segments: () => ["log", "receipts.jsonl"],
});

let root: string;
let machine: ReturnType<typeof stateTree>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-store-"));
  machine = stateTree(root);
  mkdirSync(machine.state, { recursive: true });
  vi.mocked(renameSync).mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const value = () => valueKind.in(machine, "work.json");
const home = () => authoredKind.in(machine.home({ root: join(root, "home"), tier: "user" }));
const blob = (bytes: string) => join(machine.blobs, "sha256", sha256Hex(bytes));
const seed = (file: { path: string }, bytes: string) => {
  mkdirSync(join(file.path, ".."), { recursive: true });
  writeFileSync(file.path, bytes);
};
const held = (path: string, from = 0) => {
  const real = vi.mocked(readFileSync).getMockImplementation()!;
  let reads = 0;
  vi.mocked(readFileSync).mockImplementation(((target: never, ...args: never[]) => {
    if (target === path && reads++ >= from)
      throw Object.assign(Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    return (real as (...args: never[]) => unknown)(target, ...args);
  }) as typeof readFileSync);
  return () => vi.mocked(readFileSync).mockImplementation(real);
};

test("atomic state writes replace complete bytes and leave no staging file", () => {
  const file = textKind.in(machine, "state.json");
  writeState(file, "one");
  writeState(file, new TextEncoder().encode("two"));
  expect(readFileSync(file.path, "utf8")).toBe("two");
  expect(readdirSync(machine.state)).toEqual(["state.json"]);
});
test.each(["EPERM", "EBUSY", "EACCES"])("a transient %s is retried", (code) => {
  const file = textKind.in(machine, "state.json");
  writeState(file, "one");
  vi.mocked(renameSync).mockClear();
  vi.mocked(renameSync).mockImplementationOnce(() => {
    throw Object.assign(Error("held"), { code });
  });
  writeState(file, "two");
  expect(renameSync).toHaveBeenCalledTimes(2);
  expect(readFileSync(file.path, "utf8")).toBe("two");
});
test("a partial write removes its staging file and keeps the original", () => {
  const file = textKind.in(machine, "state.json");
  writeState(file, "original");
  vi.mocked(writeFileSync).mockImplementationOnce((target, bytes) => {
    if (typeof target !== "number") throw Error("Expected the kernel's open staging descriptor");
    writeSync(target, String(bytes).slice(0, 2));
    throw Error("partial");
  });
  expect(() => writeState(file, "candidate")).toThrow("partial");
  expect(readFileSync(file.path, "utf8")).toBe("original");
  expect(readdirSync(machine.state)).toEqual(["state.json"]);
});
test("a persistent hold is bounded and keeps the original", () => {
  const file = textKind.in(machine, "state.json");
  writeState(file, "original");
  vi.mocked(renameSync).mockClear();
  const real = vi.mocked(renameSync).getMockImplementation()!;
  vi.mocked(renameSync).mockImplementation(() => {
    throw Object.assign(Error("held"), { code: "EPERM" });
  });
  try {
    expect(() => writeState(file, "candidate")).toThrow("held");
    expect(renameSync).toHaveBeenCalledTimes(6);
  } finally {
    vi.mocked(renameSync).mockImplementation(real);
  }
  expect(readFileSync(file.path, "utf8")).toBe("original");
  expect(readdirSync(machine.state)).toEqual(["state.json"]);
});
test("home writes refuse a changed or missing basis without making a blob", () => {
  const file = home();
  expect(writeHome(file, "mine", sha256Hex("was"))).toEqual({
    ok: false,
    kind: "conflict",
    actualSha256: null,
  });
  seed(file, "theirs");
  expect(writeHome(file, "mine", sha256Hex("was"))).toEqual({
    ok: false,
    kind: "conflict",
    actualSha256: sha256Hex("theirs"),
  });
  expect(readFileSync(file.path, "utf8")).toBe("theirs");
  expect(existsSync(machine.blobs)).toBe(false);
});
test("a new home file is exclusive, and an overwrite names and keeps prior bytes", () => {
  const file = home();
  expect(writeHome(file, "first", null)).toMatchObject({
    ok: true,
    priorSha256: null,
    priorBlob: null,
  });
  expect(writeHome(file, "second", null)).toMatchObject({ ok: false, kind: "conflict" });
  expect(writeHome(file, "next", sha256Hex("first"))).toMatchObject({
    ok: true,
    priorSha256: sha256Hex("first"),
    priorBlob: blob("first"),
  });
  expect(readFileSync(blob("first"), "utf8")).toBe("first");
  expect(readFileSync(file.path, "utf8")).toBe("next");
});
test("a torn prior-byte blob is repaired before an overwrite", () => {
  const file = home();
  seed(file, "prior");
  seed({ path: blob("prior") }, "pri");
  expect(writeHome(file, "next", sha256Hex("prior")).ok).toBe(true);
  expect(readFileSync(blob("prior"), "utf8")).toBe("prior");
});
test("a missing file is missing, and a BOM file decodes with its own hash", () => {
  const file = value();
  expect(read(file)).toEqual({ kind: "missing" });
  seed(file, '\uFEFF{"name":"a"}');
  expect(read(file)).toEqual({
    kind: "ok",
    value: { name: "a" },
    sha256: sha256Hex(readFileSync(file.path)),
  });
  expect(notices(machine)).toEqual([]);
});
test.each(["{ not json", '{"name":1}'])("authored bytes %s are refused and kept", (bytes) => {
  const file = home();
  seed(file, bytes);
  expect(read(file)).toMatchObject({ kind: "kept" });
  expect(read(file)).toMatchObject({ kind: "kept" });
  expect(readFileSync(file.path, "utf8")).toBe(bytes);
  expect(notices(machine)).toMatchObject([
    { class: "keep", path: file.path, sha256: sha256Hex(bytes) },
  ]);
});
test.each(["{ not json", '{"name":1}'])(
  "state bytes %s are kept before set-aside, with one notice per hash",
  (bytes) => {
    const file = value();
    seed(file, bytes);
    expect(read(file)).toMatchObject({ kind: "set-aside", blob: blob(bytes) });
    expect(readFileSync(blob(bytes), "utf8")).toBe(bytes);
    expect(existsSync(file.path)).toBe(false);
    expect(read(file)).toEqual({ kind: "missing" });
    seed(file, bytes);
    read(file);
    expect(notices(machine)).toHaveLength(1);
    seed(file, "other garbage");
    read(file);
    expect(notices(machine)).toHaveLength(2);
  },
);
test("a kind can decode a format other than one JSON value", () => {
  const kind = stateKind({
    schema: z.array(schema),
    place: () => "Rows",
    segments: () => ["rows.jsonl"],
    parse: (text) =>
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  });
  const file = kind.in(machine);
  seed(file, '{"name":"a"}\n{"name":"b"}\n');
  expect(read(file)).toMatchObject({ kind: "ok", value: [{ name: "a" }, { name: "b" }] });
});
test("unreadable state stays, including an owner's own refusal", () => {
  const file = value();
  seed(file, '{"name":"mine"}');
  const release = held(file.path);
  expect(read(file)).toMatchObject({ kind: "kept" });
  expect(setAside(file, "stale")).toMatchObject({ kind: "kept" });
  release();
  expect(readFileSync(file.path, "utf8")).toBe('{"name":"mine"}');
  expect(notices(machine)).toMatchObject([{ class: "keep", path: file.path, sha256: null }]);
});
test("a failed copy keeps the file and blocks replacement until its bytes can rest", () => {
  const file = value();
  seed(file, "{ torn");
  writeFileSync(machine.blobs, "blocked");
  expect(read(file)).toMatchObject({ kind: "kept" });
  expect(setAside(file, "stale")).toMatchObject({ kind: "kept" });
  expect(() => writeState(file, "fresh")).toThrow();
  expect(readFileSync(file.path, "utf8")).toBe("{ torn");
  rmSync(machine.blobs);
  writeState(file, "fresh");
  expect(readFileSync(blob("{ torn"), "utf8")).toBe("{ torn");
  expect(readFileSync(file.path, "utf8")).toBe("fresh");
});
test("a locked file also blocks replacement until its original bytes can rest", () => {
  const file = value();
  seed(file, '{"name":"mine"}');
  const release = held(file.path);
  expect(read(file)).toMatchObject({ kind: "kept" });
  expect(() => writeState(file, "fresh")).toThrow(/EBUSY/);
  release();
  writeState(file, "fresh");
  expect(readFileSync(blob('{"name":"mine"}'), "utf8")).toBe('{"name":"mine"}');
});

test("a short copy is detected by independent readback and keeps its original", () => {
  const file = value();
  seed(file, "{ torn");
  const real = vi.mocked(writeFileSync).getMockImplementation()!;
  vi.mocked(writeFileSync).mockImplementationOnce((target) => real(target, "{ to"));
  expect(read(file)).toMatchObject({ kind: "kept" });
  expect(readFileSync(file.path, "utf8")).toBe("{ torn");
  expect(read(file)).toMatchObject({ kind: "set-aside" });
  expect(readFileSync(blob("{ torn"), "utf8")).toBe("{ torn");
});

test("a file changed or locked during its copy stays", () => {
  const file = value();
  seed(file, "{ torn");
  const real = vi.mocked(writeFileSync).getMockImplementation()!;
  vi.mocked(writeFileSync).mockImplementationOnce((target, bytes) => {
    real(file.path, '{"name":"new"}');
    return real(target, bytes);
  });
  expect(read(file)).toMatchObject({ kind: "kept" });
  expect(readFileSync(file.path, "utf8")).toBe('{"name":"new"}');
  seed(file, "{ other");
  const release = held(file.path, 1);
  expect(read(file)).toMatchObject({ kind: "kept" });
  release();
  expect(readFileSync(file.path, "utf8")).toBe("{ other");
});

test("derived readers skip forged names without removing bytes, and a write repairs the name", () => {
  const dir = derivedIn(machine);
  const path = dir.file(derivedName("key", "whole"));
  seed({ path }, "forged");
  expect(readDerivedIn(dir, "key")).toBeNull();
  expect(readFileSync(path, "utf8")).toBe("forged");
  expect(notices(machine)).toMatchObject([{ class: "keep", path, sha256: sha256Hex("forged") }]);
  expect(writeDerivedIn(dir, "key", "whole").path).toBe(path);
  expect(readDerivedIn(dir, "key")?.bytes.toString()).toBe("whole");
  expect(readFileSync(blob("forged"), "utf8")).toBe("forged");
  vi.mocked(writeFileSync).mockClear();
  writeDerivedIn(dir, "key", "whole");
  expect(
    vi
      .mocked(writeFileSync)
      .mock.calls.every(([, , options]) => typeof options === "object" && options?.flag === "wx"),
  ).toBe(true);
});
test("an unavailable notice writer never stops a verified set-aside", () => {
  const file = value();
  seed(file, "{ torn");
  const actual = vi.mocked(writeFileSync).getMockImplementation()!;
  vi.mocked(writeFileSync).mockImplementation((...args) => {
    if (typeof args[1] === "string" && args[1].includes('"place":'))
      throw Error("notice unavailable");
    return actual(...args);
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(read(file)).toMatchObject({ kind: "set-aside" });
    expect(existsSync(file.path)).toBe(false);
    expect(readFileSync(blob("{ torn"), "utf8")).toBe("{ torn");
    expect(warn).toHaveBeenCalledOnce();
  } finally {
    vi.mocked(writeFileSync).mockImplementation(actual);
    warn.mockRestore();
  }
});
test("an owner sets aside exactly one file with one notice, and siblings stay identical", () => {
  const file = value();
  seed(file, '{"name":"stale"}');
  const sibling = textKind.in(machine, "sibling.json");
  seed(sibling, "keep");
  expect(setAside(file, "identity does not match")).toMatchObject({ kind: "set-aside" });
  expect(setAside(file, "identity does not match")).toEqual({ kind: "missing" });
  expect(readFileSync(sibling.path, "utf8")).toBe("keep");
  expect(notices(machine)).toMatchObject([
    { reason: expect.stringContaining("identity does not match") },
  ]);
});
test("a directory cannot be set aside, and all children stay", () => {
  const folder = valueKind.in(machine, "folder");
  const child = join(folder.path, "child.json");
  seed({ path: child }, "keep");
  expect(read(folder)).toMatchObject({ kind: "kept" });
  expect(setAside(folder, "stale")).toMatchObject({ kind: "kept" });
  expect(readFileSync(child, "utf8")).toBe("keep");
});

test("a missing log is missing, and whole lines list in order", () => {
  const log = eventsKind.in(machine);
  expect(readLines(log)).toEqual({ kind: "missing" });
  appendLine(log, { id: 1 });
  appendLine(log, { id: 2 });
  expect(readLines(log)).toEqual({ kind: "ok", values: [{ id: 1 }, { id: 2 }], skipped: 0 });
  expect(notices(machine)).toEqual([]);
});
test("a torn tail stays and posts once, while later appends start their own line", () => {
  const log = eventsKind.in(machine);
  appendLine(log, { id: 1 });
  writeFileSync(log.path, '{"id":2', { flag: "a" });
  const prior = readFileSync(log.path);
  expect(readLines(log)).toMatchObject({ skipped: 1 });
  expect(readLines(log)).toMatchObject({ skipped: 1 });
  expect(readFileSync(log.path)).toEqual(prior);
  appendLine(log, { id: 3 });
  expect(readFileSync(log.path, "utf8")).toBe('{"id":1}\n{"id":2\n{"id":3}\n');
  expect(readLines(log)).toEqual({ kind: "ok", values: [{ id: 1 }, { id: 3 }], skipped: 1 });
  expect(notices(machine)).toHaveLength(1);
});
test("bad middle lines and wrong shapes each post their own hash without hiding good lines", () => {
  const log = eventsKind.in(machine);
  seed(log, '{"id":1}\nnot json\n{"id":"two"}\n{"id":4}\n');
  expect(readLines(log)).toMatchObject({ values: [{ id: 1 }, { id: 4 }], skipped: 2 });
  expect(notices(machine).map((notice) => notice.sha256)).toEqual([
    sha256Hex("not json"),
    sha256Hex('{"id":"two"}'),
  ]);
});
