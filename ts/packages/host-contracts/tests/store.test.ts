import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  discardStored,
  readStored,
  readStoredNotices,
  sha256Hex,
  writeAtomic,
  writeHomeFile,
} from "../src/store.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, renameSync: vi.fn(fs.renameSync) };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-store-"));
  vi.mocked(renameSync).mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("writeAtomic", () => {
  test("creates the folder, replaces the file and leaves no temp file", () => {
    const path = join(root, "deep", "state.json");
    writeAtomic(path, "one");
    writeAtomic(path, new TextEncoder().encode("two"));
    expect(readFileSync(path, "utf8")).toBe("two");
    expect(readdirSync(join(root, "deep"))).toEqual(["state.json"]);
  });

  test.each(["EPERM", "EBUSY", "EACCES"])("a transient %s is retried", (code) => {
    const path = join(root, "state.json");
    writeAtomic(path, "one");
    vi.mocked(renameSync).mockClear();
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("a reader holds the file"), { code });
    });
    writeAtomic(path, "two");
    expect(renameSync).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, "utf8")).toBe("two");
  });

  test("a held file is bounded, keeps the old bytes and removes the temp file", () => {
    const path = join(root, "state.json");
    writeAtomic(path, "one");
    vi.mocked(renameSync).mockClear();
    const held = Object.assign(new Error("still held"), { code: "EPERM" });
    vi.mocked(renameSync).mockImplementation(() => {
      throw held;
    });
    try {
      expect(() => writeAtomic(path, "two")).toThrow(held);
      expect(renameSync).toHaveBeenCalledTimes(6);
    } finally {
      vi.mocked(renameSync).mockReset();
    }
    expect(readFileSync(path, "utf8")).toBe("one");
    expect(readdirSync(root)).toEqual(["state.json"]);
  });
});

describe("writeHomeFile", () => {
  // Freeze shape 7: the host passes `<machine state root>/state/Blobs`.
  const blobRoot = () => join(root, "state", "Blobs");
  const home = () => join(root, "home", "Pods", "a", "pod.json");

  test("a changed sha is a conflict: no write, no blob", () => {
    writeAtomic(home(), "theirs");
    const result = writeHomeFile(home(), "mine", {
      expectSha256: sha256Hex("what I read"),
      blobRoot: blobRoot(),
    });
    expect(result).toEqual({ ok: false, kind: "conflict", actualSha256: sha256Hex("theirs") });
    expect(readFileSync(home(), "utf8")).toBe("theirs");
    expect(existsSync(blobRoot())).toBe(false);
  });

  test("an expected file that is gone is a conflict", () => {
    expect(
      writeHomeFile(home(), "mine", { expectSha256: sha256Hex("was"), blobRoot: blobRoot() }),
    ).toEqual({ ok: false, kind: "conflict", actualSha256: null });
    expect(existsSync(home())).toBe(false);
  });

  test("expectSha256 null creates exclusively", () => {
    const created = writeHomeFile(home(), "first", { expectSha256: null, blobRoot: blobRoot() });
    expect(created).toEqual({
      ok: true,
      sha256: sha256Hex("first"),
      priorSha256: null,
      priorBlob: null,
    });
    expect(writeHomeFile(home(), "second", { expectSha256: null, blobRoot: blobRoot() })).toEqual({
      ok: false,
      kind: "conflict",
      actualSha256: sha256Hex("first"),
    });
    expect(readFileSync(home(), "utf8")).toBe("first");
  });

  test("an overwrite keeps the prior bytes under their own hash and names it", () => {
    writeAtomic(home(), "prior bytes");
    const result = writeHomeFile(home(), "next bytes", {
      expectSha256: sha256Hex("prior bytes"),
      blobRoot: blobRoot(),
    });
    if (!result.ok) throw Error("expected a write");
    expect(result.sha256).toBe(sha256Hex("next bytes"));
    expect(result.priorSha256).toBe(sha256Hex("prior bytes"));
    expect(result.priorBlob).toBe(join(blobRoot(), "sha256", sha256Hex("prior bytes")));
    expect(readFileSync(result.priorBlob!, "utf8")).toBe("prior bytes");
    expect(sha256Hex(readFileSync(result.priorBlob!))).toBe(result.priorSha256);
    expect(readFileSync(home(), "utf8")).toBe("next bytes");
  });

  test("a blob torn by a crash is rewritten on the next overwrite", () => {
    writeAtomic(home(), "prior bytes");
    const blob = join(blobRoot(), "sha256", sha256Hex("prior bytes"));
    writeAtomic(blob, "pri");
    writeHomeFile(home(), "next", { expectSha256: sha256Hex("prior bytes"), blobRoot: blobRoot() });
    expect(readFileSync(blob, "utf8")).toBe("prior bytes");
  });
});

describe("readStored", () => {
  const schema = z.strictObject({ name: z.string() });
  const notices = () => join(root, "state", "stored-notices.jsonl");
  const discard = () => ({ class: "discard", place: "Work for /ducts", notices: notices() }) as const;

  test("a file that decodes comes back with its sha; a missing one is missing", () => {
    const path = join(root, "a.json");
    expect(readStored(path, schema, discard())).toEqual({ kind: "missing" });
    writeFileSync(path, '﻿{"name":"a"}');
    expect(readStored(path, schema, discard())).toEqual({
      kind: "ok",
      value: { name: "a" },
      sha256: sha256Hex(readFileSync(path)),
    });
    expect(readStoredNotices(notices())).toEqual([]);
  });

  test.each(["{ not json", '{"name":1}'])("keep refuses %s and never touches its bytes", (bytes) => {
    const path = join(root, "pod.json");
    writeFileSync(path, bytes);
    const read = readStored(path, schema, { class: "keep", place: "Pod a", notices: notices() });
    expect(read.kind).toBe("kept");
    expect(read.kind === "kept" && read.reason).toBeTruthy();
    expect(readFileSync(path, "utf8")).toBe(bytes);
    expect(readdirSync(root).sort()).toEqual(["pod.json", "state"]);
    readStored(path, schema, { class: "keep", place: "Pod a", notices: notices() });
    expect(readStoredNotices(notices())).toMatchObject([
      { class: "keep", place: "Pod a", path, sha256: sha256Hex(bytes) },
    ]);
  });

  test.each(["{ not json", '{"name":1}'])(
    "discard deletes %s with exactly one notice that does not repeat",
    (bytes) => {
      const path = join(root, "work.json");
      writeFileSync(path, bytes);
      expect(readStored(path, schema, discard()).kind).toBe("discarded");
      expect(existsSync(path)).toBe(false);
      expect(readStored(path, schema, discard())).toEqual({ kind: "missing" });
      // The same bytes back at the same path (a failed delete, a restored copy) post nothing new.
      writeFileSync(path, bytes);
      expect(readStored(path, schema, discard()).kind).toBe("discarded");
      expect(readStoredNotices(notices())).toMatchObject([
        { class: "discard", place: "Work for /ducts", path, sha256: sha256Hex(bytes) },
      ]);
      // Different bytes are a different loss.
      writeFileSync(path, "other garbage");
      readStored(path, schema, discard());
      expect(readStoredNotices(notices())).toHaveLength(2);
    },
  );

  test("a custom parse reads a file that is not one JSON value", () => {
    const path = join(root, "log.jsonl");
    writeFileSync(path, '{"name":"a"}\n{"name":"b"}\n');
    const lines = (text: string) => text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(readStored(path, z.array(schema), { ...discard(), parse: lines })).toMatchObject({
      kind: "ok",
      value: [{ name: "a" }, { name: "b" }],
    });
  });

  test("a path that cannot be read as a file is refused, not thrown", () => {
    expect(readStored(root, schema, { class: "keep", place: "A folder" }).kind).toBe("kept");
  });

  test("an unreadable notice file never stops a discard", () => {
    const path = join(root, "work.json");
    writeFileSync(path, "{");
    writeFileSync(join(root, "blocked"), "a file where the notice folder should be");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = readStored(path, schema, {
      class: "discard",
      place: "Work",
      notices: join(root, "blocked", "notices.jsonl"),
    });
    expect(read.kind).toBe("discarded");
    expect(existsSync(path)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  test("discardStored posts one notice for a file its owner refused", () => {
    const path = join(root, "work.json");
    writeFileSync(path, '{"name":"stale"}');
    discardStored(path, discard(), "identity does not match");
    discardStored(path, discard(), "identity does not match");
    expect(existsSync(path)).toBe(false);
    expect(readStoredNotices(notices())).toMatchObject([{ reason: "identity does not match" }]);
  });
});
