import {
  existsSync,
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
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  appendStoredLine,
  derivedName,
  discardStored,
  readDerived,
  readStored,
  readStoredLines,
  readStoredNotices,
  sha256Hex,
  storedNoticesFile,
  writeAtomic,
  writeDerived,
  writeHomeFile,
} from "../src/store.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    readFileSync: vi.fn(fs.readFileSync),
    renameSync: vi.fn(fs.renameSync),
    writeFileSync: vi.fn(fs.writeFileSync),
  };
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

  test("a write that fails part way removes its own temp file and keeps the old bytes", () => {
    const path = join(root, "state.json");
    writeAtomic(path, "original");
    const failure = new Error("injected partial write");
    vi.mocked(writeFileSync).mockImplementationOnce((file, bytes) => {
      writeSync(file as number, String(bytes).slice(0, 2));
      throw failure;
    });
    expect(() => writeAtomic(path, "candidate")).toThrow(failure);
    expect(readFileSync(path, "utf8")).toBe("original");
    expect(readdirSync(root)).toEqual(["state.json"]);
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
      // A caller that names no blob root still loses nothing: the bytes rest beside the notice file.
      expect(readFileSync(join(root, "state", "Blobs", "sha256", sha256Hex(bytes)), "utf8")).toBe(bytes);
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

  // K-A1 falsifiers, each with its mutant in `store.ts`.
  // Locked file: in `refuse`, send `!bytes` in the discard class to `rmSync` (the code before ST1).
  // Unwritable blob root: in `refuse`, let the `catch` after `restBlob` fall through to `rmSync`.
  // Short copy: in `restBlob`, drop the `rests()` check after `writeAtomic`.
  // Changed while copied: in `refuse`, drop the re-read before `rmSync`.
  const held = (path: string, from = 0) => {
    const real = vi.mocked(readFileSync).getMockImplementation()!;
    let reads = 0;
    vi.mocked(readFileSync).mockImplementation(((target: never, ...rest: never[]) => {
      if (target === path && reads++ >= from)
        throw Object.assign(Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      return (real as (...args: never[]) => unknown)(target, ...rest);
    }) as typeof readFileSync);
    return () => vi.mocked(readFileSync).mockImplementation(real);
  };

  test("a locked file is kept in the discard class: it still exists and one notice posted", () => {
    const path = join(root, "work.json");
    writeFileSync(path, '{"name":"mine"}');
    const release = held(path);
    expect(readStored(path, schema, discard())).toMatchObject({ kind: "kept" });
    expect(readStored(path, schema, discard())).toMatchObject({ kind: "kept" });
    release();
    expect(readFileSync(path, "utf8")).toBe('{"name":"mine"}');
    const posted = readStoredNotices(notices());
    expect(posted).toMatchObject([{ class: "keep", place: "Work for /ducts", path, sha256: null }]);
    expect(posted[0]!.reason).toContain("EBUSY");
    // An owner's own refusal of a file it cannot read keeps it too.
    const again = held(path);
    discardStored(path, discard(), "stale");
    again();
    expect(readFileSync(path, "utf8")).toBe('{"name":"mine"}');
  });

  test("a blob root that cannot be written keeps the original, with one notice", () => {
    const path = join(root, "work.json");
    writeFileSync(path, "{ torn");
    writeFileSync(join(root, "not-a-folder"), "");
    const policy = { ...discard(), blobRoot: join(root, "not-a-folder") };
    expect(readStored(path, schema, policy)).toMatchObject({ kind: "kept" });
    expect(readStored(path, schema, policy)).toMatchObject({ kind: "kept" });
    expect(readFileSync(path, "utf8")).toBe("{ torn");
    const posted = readStoredNotices(notices());
    expect(posted).toMatchObject([{ class: "keep", path, sha256: sha256Hex("{ torn") }]);
    expect(posted[0]!.reason).toContain("could not be copied aside");
    discardStored(path, policy, "stale");
    expect(readFileSync(path, "utf8")).toBe("{ torn");
  });

  test("a copy that does not read back as the original keeps the original", () => {
    const path = join(root, "work.json");
    writeFileSync(path, "{ torn");
    // The one write of the set-aside is the blob's temp file: it lands short.
    const real = vi.mocked(writeFileSync).getMockImplementation()!;
    vi.mocked(writeFileSync).mockImplementationOnce((file) => real(file, "{ to"));
    expect(readStored(path, schema, discard())).toMatchObject({ kind: "kept" });
    expect(readFileSync(path, "utf8")).toBe("{ torn");
    // The next read copies it whole and sets it aside.
    expect(readStored(path, schema, discard())).toMatchObject({ kind: "discarded" });
    expect(readFileSync(join(root, "state", "Blobs", "sha256", sha256Hex("{ torn")), "utf8")).toBe(
      "{ torn",
    );
    expect(existsSync(path)).toBe(false);
  });

  test("a file that changes or locks while it is copied aside is kept", () => {
    const path = join(root, "work.json");
    writeFileSync(path, "{ torn");
    const real = vi.mocked(writeFileSync).getMockImplementation()!;
    // Another writer lands new bytes at the path during the copy.
    vi.mocked(writeFileSync).mockImplementationOnce((file, bytes) => {
      real(path, '{"name":"new"}');
      return real(file, bytes);
    });
    expect(readStored(path, schema, discard())).toMatchObject({ kind: "kept" });
    expect(readFileSync(path, "utf8")).toBe('{"name":"new"}');
    writeFileSync(path, "{ other");
    const release = held(path, 1);
    expect(readStored(path, schema, discard())).toMatchObject({ kind: "kept" });
    release();
    expect(readFileSync(path, "utf8")).toBe("{ other");
  });

  test("a derived file whose name does not match its bytes stays, is skipped, and posts one notice", () => {
    // Mutant: in `readDerived`, call `discardDerived` on the mismatch (the forged file is removed).
    const store = { dir: join(root, "Derived"), notices: notices(), blobRoot: join(root, "state", "Blobs") };
    const wrong = join(store.dir, `key.${sha256Hex("other bytes")}`);
    writeAtomic(wrong, "forged");
    expect(readDerived(store, "key")).toBeNull();
    writeAtomic(join(store.dir, derivedName("key", "whole")), "whole");
    expect(readDerived(store, "key")?.bytes.toString()).toBe("whole");
    expect(readFileSync(wrong, "utf8")).toBe("forged");
    expect(readStoredNotices(notices())).toMatchObject([
      { class: "keep", place: "Derived file", path: wrong, sha256: sha256Hex("forged") },
    ]);
  });

  test("a derived write replaces bytes that hold its name falsely, and rests them first", () => {
    // Mutant: in `writeDerived`, drop the second `writeHomeFile` (the forged file holds the name).
    const store = { dir: join(root, "Derived"), notices: notices(), blobRoot: join(root, "state", "Blobs") };
    const path = join(store.dir, derivedName("key", "whole"));
    writeAtomic(path, "forged");
    expect(readDerived(store, "key")).toBeNull();
    expect(writeDerived(store, "key", "whole")).toBe(path);
    expect(readDerived(store, "key")?.bytes.toString()).toBe("whole");
    expect(readFileSync(join(store.blobRoot, "sha256", sha256Hex("forged")), "utf8")).toBe("forged");
    // A whole file is never rewritten.
    vi.mocked(writeFileSync).mockClear();
    writeDerived(store, "key", "whole");
    expect(vi.mocked(writeFileSync).mock.calls.filter(([, , o]) => (o as { flag?: string })?.flag !== "wx")).toEqual([]);
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
      blobRoot: join(root, "state", "Blobs"),
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
    expect(readStoredNotices(notices())).toMatchObject([
      { reason: expect.stringContaining("identity does not match") },
    ]);
  });

  test("a discard with a blobRoot rests the bytes under the hash its notice names, then deletes", () => {
    const blobRoot = join(root, "state", "Blobs");
    const kept = { ...discard(), blobRoot };
    const path = join(root, "journal.jsonl");
    const torn = '{"name":';
    writeFileSync(path, torn);
    expect(readStored(path, schema, kept)).toMatchObject({ kind: "discarded" });
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(join(blobRoot, "sha256", sha256Hex(torn)), "utf8")).toBe(torn);
    expect(readStoredNotices(notices())).toMatchObject([{ sha256: sha256Hex(torn) }]);
    // An owner's own refusal takes the same path, and the same bytes twice are one blob.
    writeFileSync(path, torn);
    discardStored(path, kept, "another epoch");
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(join(blobRoot, "sha256"))).toEqual([sha256Hex(torn)]);
    // `storedNoticesFile` is the path every poster and the host's feed agree on.
    expect(storedNoticesFile(root)).toBe(notices());
  });
});

describe("a discard names exactly one file", () => {
  const notices = () => join(root, "state", "stored-notices.jsonl");
  const tree = (dir: string): Record<string, string> =>
    Object.fromEntries(
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const path = join(entry.parentPath, entry.name);
          return [path.slice(dir.length + 1), sha256Hex(readFileSync(path))];
        }),
    );

  test("inside a pod folder, every sibling stays byte-identical", () => {
    // Discard-class files live inside keep-class folders: provenance, run output, Page state.
    const pod = join(root, "Pods", "ducts");
    writeAtomic(join(pod, "pod.json"), '{"id":"ducts"}');
    writeAtomic(join(pod, "settings", "sizing.json"), '{"velocity":900}');
    writeAtomic(join(pod, "output", "run-1", "receipt.json"), '{"ok":true}');
    writeAtomic(join(pod, "output", "run-1", "input.json"), "{ torn");
    writeAtomic(join(pod, "imported.json"), "{ torn");
    const before = tree(pod);

    const read = readStored(join(pod, "imported.json"), z.strictObject({ name: z.string() }), {
      class: "discard",
      place: "Pod ducts provenance",
      notices: notices(),
    });

    expect(read.kind).toBe("discarded");
    const { "imported.json": gone, ...siblings } = before;
    expect(gone).toBeDefined();
    expect(tree(pod)).toEqual(siblings);
  });

  test("a discard aimed at a folder removes nothing", () => {
    const pod = join(root, "Pods", "ducts");
    writeAtomic(join(pod, "pod.json"), '{"id":"ducts"}');
    writeAtomic(join(pod, "output", "run-1", "receipt.json"), '{"ok":true}');
    const before = tree(pod);
    const policy = { class: "discard", place: "Pod ducts", notices: notices() } as const;

    expect(readStored(pod, z.unknown(), policy).kind).toBe("kept");
    expect(readStored(join(pod, "output"), z.unknown(), policy).kind).toBe("kept");
    expect(() => discardStored(pod, policy, "stale")).not.toThrow();

    expect(tree(pod)).toEqual(before);
  });
});

describe("an append-only log decodes per line", () => {
  const schema = z.strictObject({ id: z.number() });
  const notices = () => join(root, "state", "stored-notices.jsonl");
  const log = () => join(root, "log", "receipts.jsonl");
  const policy = () => ({ place: "Capture receipts", notices: notices() });

  test("a missing log is missing; a whole one lists every line", () => {
    expect(readStoredLines(log(), schema, policy())).toEqual({ kind: "missing" });
    appendStoredLine(log(), '{"id":1}');
    appendStoredLine(log(), '{"id":2}');
    expect(readStoredLines(log(), schema, policy())).toEqual({
      kind: "ok",
      values: [{ id: 1 }, { id: 2 }],
      skipped: 0,
    });
    expect(readStoredNotices(notices())).toEqual([]);
  });

  test("a torn last line leaves every other line listed, posts one notice, and changes no byte", () => {
    appendStoredLine(log(), '{"id":1}');
    appendStoredLine(log(), '{"id":2}');
    writeFileSync(log(), '{"id":3', { flag: "a" });
    const bytes = readFileSync(log());

    const read = () => readStoredLines(log(), schema, policy());
    expect(read()).toEqual({ kind: "ok", values: [{ id: 1 }, { id: 2 }], skipped: 1 });
    expect(read()).toMatchObject({ skipped: 1 });
    expect(readFileSync(log())).toEqual(bytes);
    expect(readStoredNotices(notices())).toMatchObject([
      { class: "keep", place: "Capture receipts", path: log(), sha256: sha256Hex('{"id":3') },
    ]);
  });

  test("appends continue after a torn tail, and the new line is not joined onto it", () => {
    appendStoredLine(log(), '{"id":1}');
    writeFileSync(log(), '{"id":2', { flag: "a" });
    appendStoredLine(log(), '{"id":3}');
    expect(readFileSync(log(), "utf8")).toBe('{"id":1}\n{"id":2\n{"id":3}\n');
    expect(readStoredLines(log(), schema, policy())).toEqual({
      kind: "ok",
      values: [{ id: 1 }, { id: 3 }],
      skipped: 1,
    });
  });

  test("a bad line in the middle, or of the wrong shape, is one notice each by its own hash", () => {
    writeAtomic(log(), '{"id":1}\nnot json\n{"id":"two"}\n{"id":4}\n');
    expect(readStoredLines(log(), schema, policy())).toMatchObject({
      values: [{ id: 1 }, { id: 4 }],
      skipped: 2,
    });
    expect(readStoredNotices(notices()).map((notice) => notice.sha256)).toEqual([
      sha256Hex("not json"),
      sha256Hex('{"id":"two"}'),
    ]);
  });
});
