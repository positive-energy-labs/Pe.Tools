/**
 * Public operations take kind-minted files. Bare-path I/O stays private here: every caller gets
 * its path, preservation rule, notices and blob store from the declared kind (routes K-A2).
 *
 * The store kernel (ADR 0039; ADR 0037 rules 5 to 7): one atomic write for machine state, one write
 * door into a home, and one decode at the trust boundary that carries the two failure policies.
 * Readers do not throw on a file that does not decode. Synchronous to serve synchronous owners.
 * ponytail: sync I/O blocks for one small file and passing Windows locks; add an async twin only
 * when a write is measured slow.
 */
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  sha256Hex,
  storedNoticeSchema,
  derivedName,
  type HomeWrite,
  type StoredNotice,
  type ReadRule,
  type StoredRead,
  type DerivedStore,
  policyOf,
  settled,
} from "./store-values.ts";
export {
  sha256Hex,
  storedNoticeSchema,
  derivedKey,
  derivedName,
  type HomeWrite,
  type StoredNotice,
} from "./store-values.ts";
import { mintStatePath } from "./store-paths.ts";
import { GeneratedFile, StoredFile } from "./kinds.ts";
import type {
  At,
  HomePath,
  StateRoot,
  StatePath,
  Stored,
  StoredLog,
  DerivedDir,
  DerivedFile,
} from "./kinds.ts";

const errno = (error: unknown) => (error as NodeJS.ErrnoException).code ?? "";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Windows refuses a rename while a scanner or the indexer holds the target; the hold ends in milliseconds. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
const pause = (ms: number) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const ensureParent = (path: string) => mkdirSync(dirname(path), { recursive: true });

/** The file's bytes, or null when it is missing. A passing hold is waited out, as a rename is. */
const readOrNull = (path: string): Buffer | null => {
  for (let attempt = 0; ; attempt++)
    try {
      return readFileSync(path);
    } catch (error) {
      if (errno(error) === "ENOENT") return null;
      if (attempt >= 3 || !TRANSIENT.has(errno(error))) throw error;
      pause(25 * 2 ** attempt);
    }
};

/**
 * State files this process kept though their class is discard (unreadable, or no copy could be
 * made), each with the blob root their bytes are owed to. Their owner reads them as absent and
 * will write a fresh file, so `writeAtomic` settles the debt first: it rests the bytes that are
 * there, or it refuses the write.
 * ponytail: per process. A writer that never read the file in this process is not guarded; every
 * state owner reads before it writes. Move the debt to a file beside the notices if that changes.
 */
const owed = new Map<string, StatePath>();

/**
 * Machine state, no compare: a temp file in the same directory, then a rename over the target. A
 * reader sees the old bytes or the new ones, never a torn file. Creates the parent directory.
 */
function writeAtomic(path: string, bytes: Uint8Array | string): void {
  const blobRoot = owed.get(resolve(path));
  if (blobRoot) {
    // Throws while the file is still unreadable or the copy still fails: the write is refused
    // and the kept bytes stay.
    const prior = readOrNull(path);
    if (prior) restBlob(blobRoot, sha256Hex(prior), prior);
    owed.delete(resolve(path));
  }
  ensureParent(path);
  // A random name keeps two writers from tearing one temp file; a failed write removes its own.
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(file, bytes);
      try {
        fsyncSync(file);
      } catch {
        // Best effort: a synced drive may refuse a flush, and the rename is still atomic.
      }
    } finally {
      closeSync(file);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return renameSync(temporary, path);
      } catch (error) {
        if (attempt >= 5 || !TRANSIENT.has(errno(error))) throw error;
        pause(25 * 2 ** attempt);
      }
    }
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Build output has no authored bytes to preserve. Publish atomically only when bytes differ. */
export function writeGenerated(file: GeneratedFile, bytes: Uint8Array | string): void {
  GeneratedFile.assert(file);
  if (readOrNull(file.path)?.equals(Buffer.from(bytes))) return;
  writeAtomic(file.path, bytes);
}

/**
 * The one way to write into a home (ADR 0037 rule 5): a compare-and-swap on SHA-256.
 * `expectSha256: null` means the file must not exist. Before an overwrite the prior bytes go to
 * `<blobRoot>/sha256/<hash>` on this machine (rule 7, the safety net), and the receipt names them.
 */
function writeHomeFile(
  path: string,
  bytes: Uint8Array | string,
  opts: { expectSha256: string | null; blobRoot: StatePath },
): HomeWrite {
  const next = Buffer.from(bytes);
  const conflict = (actualSha256: string | null): HomeWrite => ({
    ok: false,
    kind: "conflict",
    actualSha256,
  });
  if (opts.expectSha256 === null) {
    ensureParent(path);
    try {
      // ponytail: exclusive create straight onto the target, because a synced drive has no hard
      // link to publish a temp file with. A crash mid-write leaves a torn file, which the keep
      // policy then lists as "can't read, kept". Publish by link if homes ever sit on NTFS only.
      writeFileSync(path, next, { flag: "wx" });
    } catch (error) {
      if (errno(error) !== "EEXIST") throw error;
      const actual = readOrNull(path);
      return conflict(actual && sha256Hex(actual));
    }
    return { ok: true, sha256: sha256Hex(next), priorSha256: null, priorBlob: null };
  }
  const prior = readOrNull(path);
  const priorSha256 = prior && sha256Hex(prior);
  if (!prior || priorSha256 !== opts.expectSha256) return conflict(priorSha256);
  const priorBlob = restBlob(opts.blobRoot, opts.expectSha256, prior);
  // ponytail: the compare above and the rename below are not one step. Two processes on this
  // machine can both pass the compare and the later rename wins; the loser's bytes are still in
  // the blob store. Ceiling: one machine, rare. A race across machines belongs to Drive, which
  // keeps both as revisions or a conflict copy. Take a lock file here if same-machine writers grow.
  writeAtomic(path, next);
  return { ok: true, sha256: sha256Hex(next), priorSha256, priorBlob };
}

/**
 * Rest bytes in the content-addressed blob store, `<blobRoot>/sha256/<hash>`, and prove the copy:
 * it returns only when the blob reads back as these bytes, and throws otherwise. A caller removes
 * or overwrites the original only after this returned.
 */
function restBlob(blobRoot: StatePath, sha256: string, bytes: Uint8Array): StatePath {
  const blob = mintStatePath(join(blobRoot, "sha256", sha256));
  const rests = () => {
    const copy = readOrNull(blob);
    return copy !== null && sha256Hex(copy) === sha256;
  };
  // A whole blob is the same bytes already; a blob torn by an earlier crash is rewritten.
  if (!rests()) {
    writeAtomic(blob, bytes);
    if (!rests())
      throw Error(`The copy at '${blob}' does not read back as the bytes it was given.`);
  }
  return blob;
}

/** Every notice posted so far. A line that does not decode is skipped: the store cannot report on itself. */
function readStoredNotices(file: string): StoredNotice[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      const notice = storedNoticeSchema.safeParse(JSON.parse(line));
      return notice.success ? [notice.data] : [];
    } catch {
      return [];
    }
  });
}

const oneLine = (why: string) => why.replace(/\s+/g, " ").slice(0, 500);

/**
 * Post one durable notice, de-duplicated by path and hash: the same bytes at the same path never
 * post twice. It never throws, because a notice that cannot be written must not stop its caller.
 * `readStored` posts through this; call it directly for a refusal that is not one decoded file
 * (a recording bundle that will not open).
 */
function noteStored(file: string, notice: Omit<StoredNotice, "at">): void {
  try {
    const path = resolve(notice.path);
    // ponytail: a scan of an append-only file per refusal, and no pruning. A refusal is rare;
    // prune by age when the file is measured large.
    const posted = readStoredNotices(file).some(
      (row) => row.path === path && row.sha256 === notice.sha256,
    );
    if (posted) return;
    ensureParent(file);
    const row: StoredNotice = {
      ...notice,
      path,
      reason: oneLine(notice.reason),
      at: new Date().toISOString(),
    };
    appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch (error) {
    console.warn(`Could not post the notice for '${notice.path}': ${message(error)}`);
  }
}

/**
 * Apply a class to a file that was refused: one notice per path and hash, and a set-aside if
 * `discard`. Set-aside is copy, verify, then remove, in that order (K-A1): the file goes only after
 * its bytes rest in the blob store. So three cases keep the file whatever the class says: its bytes
 * could not be read, the copy failed, or it changed while it was being copied.
 * A discard names exactly one file. Discard-class files sit inside keep-class folders
 * (`Pods/<pod>/imported.json`, `Pages/<slug>/.state/**`), so this never removes a folder and
 * never recurses: `rmSync` without `recursive` refuses a directory, and the refusal is swallowed.
 */
function refuse(path: string, bytes: Buffer | null, policy: ReadRule, why: string) {
  const note = (cls: ReadRule["class"], reason: string) => {
    if (policy.notices)
      noteStored(policy.notices, {
        class: cls,
        place: policy.place,
        path,
        sha256: bytes && sha256Hex(bytes),
        reason,
      });
    return reason;
  };
  const kept = (reason: string) =>
    ({ kind: "kept", reason: note("keep", oneLine(reason)) }) as const;
  if (policy.class === "keep") return kept(why);
  const blobRoot = policy.blobRoot;
  // Until the set-aside below completes, a write over this path owes its bytes a copy.
  owed.set(resolve(path), blobRoot);
  if (!bytes) return kept(why);
  let blob: StatePath;
  try {
    blob = restBlob(blobRoot, sha256Hex(bytes), bytes);
  } catch (error) {
    return kept(`Kept, because its bytes could not be copied aside (${message(error)}). ${why}`);
  }
  try {
    // ponytail: the compare and the remove are not one step; a writer landing between them loses
    // its bytes. Ceiling: one machine, one host per state root. Take a lock file if writers grow.
    const now = readOrNull(path);
    if (now && !now.equals(bytes))
      return kept(`Kept, because it changed while it was set aside. ${why}`);
  } catch (error) {
    return kept(`Kept, because it could not be read again (${message(error)}). ${why}`);
  }
  const reason = note("discard", oneLine(`Prior bytes: ${blob}. ${why}`));
  owed.delete(resolve(path));
  try {
    rmSync(path, { force: true });
  } catch {
    // A held file stays; its bytes rest in the blob store and its notice does not repeat.
  }
  return { kind: "discarded", reason, blob } as const;
}

/**
 * Decode a stored file at the trust boundary (ADR 0039 rule 1). `keep`: an authored file that does
 * not decode is refused, its bytes are never touched, and the reason comes back. `discard`: the
 * file is set aside (its bytes rest in the blob store, then it is removed) with one notice. A file
 * that could not be read is `kept` in either class. Only a missing file reads as `missing`.
 */
function readStored<T>(path: string, schema: z.ZodType<T>, policy: ReadRule): StoredRead<T> {
  let bytes: Buffer | null;
  try {
    bytes = readOrNull(path);
  } catch (error) {
    return refuse(path, null, policy, message(error));
  }
  if (!bytes) return { kind: "missing" };
  try {
    // An editor's byte-order mark is not corruption.
    const text = bytes.toString("utf8").replace(/^﻿/, "");
    const parsed = schema.safeParse((policy.parse ?? JSON.parse)(text));
    if (parsed.success) return { kind: "ok", value: parsed.data, sha256: sha256Hex(bytes) };
    return refuse(path, bytes, policy, z.prettifyError(parsed.error));
  } catch (error) {
    return refuse(path, bytes, policy, message(error));
  }
}

/**
 * Decode an append-only log one line at a time (MAP decision log, 2026-11-11). A line that does not
 * decode is left out of the read and posts one notice, de-duplicated by path and the line's hash.
 * The file is never rewritten on a read, so every other line stays listed and the bad line's bytes
 * stay for a person to inspect. `skipped` counts the lines left out of this read.
 */
function readStoredLines<T>(
  path: string,
  schema: z.ZodType<T>,
  policy: { place: string; notices: string },
): { kind: "ok"; values: T[]; skipped: number } | { kind: "missing" } {
  const skip = (line: string | null, why: string) =>
    noteStored(policy.notices, {
      class: "keep",
      place: policy.place,
      path,
      sha256: line === null ? null : sha256Hex(line),
      reason: why,
    });
  let text: string;
  try {
    const bytes = readOrNull(path);
    if (!bytes) return { kind: "missing" };
    text = bytes.toString("utf8");
  } catch (error) {
    skip(null, message(error));
    return { kind: "ok", values: [], skipped: 1 };
  }
  const values: T[] = [];
  let skipped = 0;
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let why: string;
    try {
      const parsed = schema.safeParse(JSON.parse(line));
      if (parsed.success) return void values.push(parsed.data);
      why = z.prettifyError(parsed.error);
    } catch (error) {
      why = message(error);
    }
    skipped++;
    skip(line, `Line ${index + 1} is left out: ${why}`);
  });
  return { kind: "ok", values, skipped };
}

/**
 * Append one line to an append-only log. A tail torn by a crash has no newline, and a plain append
 * would join the new line onto it and lose both; this closes the torn tail first, so appends
 * continue after a bad line.
 */
function appendStoredLine(path: string, line: string): void {
  ensureParent(path);
  const file = openSync(path, "a+");
  try {
    const size = fstatSync(file).size;
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync(file, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
    // ponytail: one write call per line, as before; two processes appending at once can still
    // interleave on a network drive. These logs are machine state on a local disk.
    writeFileSync(file, `${torn ? "\n" : ""}${line}\n`);
  } finally {
    closeSync(file);
  }
}

/** Discard a file its owner refused after decoding (a stale identity, an unsupported epoch). */
function setAsideBytes(
  path: string,
  policy: Extract<ReadRule, { class: "discard" }>,
  reason: string,
): Exclude<StoredRead<never>, { kind: "ok" }> {
  let bytes: Buffer | null;
  try {
    bytes = readOrNull(path);
  } catch (error) {
    // Not a readable file (a folder, a held file): it is kept, and the notice says why.
    return refuse(path, null, policy, `${reason} (${message(error)})`);
  }
  return bytes ? refuse(path, bytes, policy, reason) : { kind: "missing" };
}

/**
 * The derived store (ADR 0037 rule 6): one flat folder of write-once files, `<key>.<sha256 of the
 * file's own bytes>`. The key names what the file was derived from, so a second person finds it;
 * the second half lets any reader prove the bytes are intact, not who wrote them.
 * `dir` is a project home's `Derived` folder, or the machine's `state\Derived` when there is none.
 */
/**
 * The file a key names, proven by its own hash. One whose name does not match its bytes is skipped
 * with one notice and stays where it is: a reader never removes a file, and `dir` can be a folder
 * on a shared drive that another person's machine is writing.
 */
function readDerived<P extends HomePath | StatePath>(
  store: DerivedStore<P>,
  key: string,
): DerivedFile<P> | null {
  let names: string[];
  try {
    names = readdirSync(store.dir);
  } catch {
    return null;
  }
  for (const name of names.filter((name) => name.startsWith(`${key}.`)).sort()) {
    const path = store.path(name);
    let bytes: Buffer | null;
    try {
      bytes = readOrNull(path);
    } catch {
      continue; // A held file is not this read's answer, and it stays.
    }
    if (!bytes) continue;
    if (name === derivedName(key, bytes)) return { path, bytes };
    // ponytail: a file another process is still writing reads as torn and posts one notice for
    // that half-written hash. Write by temp and link if that shows.
    noteStored(store.notices, {
      class: "keep",
      place: "Derived file",
      path,
      sha256: sha256Hex(bytes),
      reason: "Skipped: its name does not match its bytes.",
    });
  }
  return null;
}

/**
 * Write once through the write door: create-exclusive, so a second writer of the same name is a
 * no-op. One case writes twice: the name is taken by bytes that do not match it (a torn or forged
 * file, which `readDerived` skips and never removes). Then the write door replaces exactly those
 * bytes, after resting them in the blob store, so a bad file cannot hold a good one's name forever.
 */
function writeDerived<P extends HomePath | StatePath>(
  store: DerivedStore<P>,
  key: string,
  bytes: Uint8Array | string,
): P {
  const path = store.path(derivedName(key, bytes));
  const made = writeHomeFile(path, bytes, { expectSha256: null, blobRoot: store.blobRoot });
  if (!made.ok && made.actualSha256 && made.actualSha256 !== sha256Hex(bytes))
    writeHomeFile(path, bytes, { expectSha256: made.actualSha256, blobRoot: store.blobRoot });
  return path;
}

/** Decode a stored file at the trust boundary, under its kind's rule. Never throws on a bad file. */
export function read<T>(file: StoredFile<T, "state">): Stored<T>;
export function read<T>(
  file: StoredFile<T, "home" | "state-kept">,
): Exclude<Stored<T>, { kind: "set-aside" }>;
export function read<T>(file: StoredFile<T, At>): Stored<T> {
  StoredFile.assert(file);
  return settled(readStored(file.path, file.kind.schema, policyOf(file)));
}

/** The one way to write into a home: a compare-and-swap on the hash the writer read (`null`: the file must not exist). */
export function writeHome<T>(
  file: StoredFile<T, "home">,
  bytes: Uint8Array | string,
  expectSha256: string | null,
): HomeWrite {
  StoredFile.assert(file, ["home"]);
  return writeHomeFile(file.path, bytes, { expectSha256, blobRoot: file.machine.blobs });
}

/** Write machine state atomically. Refused while kept bytes at the path still have no copy. */
export function writeState<T>(
  file: StoredFile<T, "state" | "state-kept">,
  bytes: Uint8Array | string,
): void {
  StoredFile.assert(file, ["state", "state-kept"]);
  if (file.kind.at === "state-kept") {
    const prior = readOrNull(file.path);
    const wrote = writeHomeFile(file.path, bytes, {
      expectSha256: prior === null ? null : sha256Hex(prior),
      blobRoot: file.machine.blobs,
    });
    if (!wrote.ok) throw Error(`Kept decision changed before its write: ${file.path}`);
  } else writeAtomic(file.path, bytes);
}

/** An owner refuses a state file it decoded (a stale identity, another epoch): set aside, one notice. */
export function setAside<T>(
  file: StoredFile<T, "state">,
  reason: string,
): Exclude<Stored<T>, { kind: "ok" }> {
  StoredFile.assert(file, ["state"]);
  const policy = policyOf(file);
  return settled(setAsideBytes(file.path, policy, reason));
}

/** Every line that decodes. A line that does not is left out with one notice and stays in the file. */
export const readLines = <T>(log: StoredLog<T>) =>
  readStoredLines(log.path, log.schema, { place: log.place, notices: log.machine.notices });
export const appendLine = <T>(log: StoredLog<T>, value: T): void =>
  appendStoredLine(log.path, JSON.stringify(value));
const derivedStoreOf = <P extends HomePath | StatePath>(dir: DerivedDir<P>): DerivedStore<P> => ({
  dir: dir.path,
  path: dir.file,
  notices: dir.machine.notices,
  blobRoot: dir.machine.blobs,
});
/** The file a key names in a derived folder, proven by its own hash; see `readDerived`. */
export const readDerivedIn = <P extends HomePath | StatePath>(
  dir: DerivedDir<P>,
  key: string,
): DerivedFile<P> | null => readDerived(derivedStoreOf(dir), key);
/** Write once into a derived folder; see `writeDerived`. */
export const writeDerivedIn = <P extends HomePath | StatePath>(
  dir: DerivedDir<P>,
  key: string,
  bytes: Uint8Array | string,
): DerivedFile<P> => ({
  path: writeDerived(derivedStoreOf(dir), key, bytes),
  bytes: Buffer.from(bytes),
});
/** An owner refuses a derived file it decoded. In a home it is kept with a notice; in state it is set aside. */
export const refuseDerived = (dir: DerivedDir, file: DerivedFile, reason: string): void => {
  const store = derivedStoreOf(dir);
  if (dir.path === dir.machine.derived)
    return void setAsideBytes(
      file.path,
      { class: "discard", place: "Derived file", notices: store.notices, blobRoot: store.blobRoot },
      reason,
    );
  noteStored(store.notices, {
    class: "keep",
    place: "Derived file",
    path: file.path,
    sha256: sha256Hex(file.bytes),
    reason,
  });
};

/** The notices posted on this machine so far. */
export const notices = (machine: StateRoot) => readStoredNotices(machine.notices);
/** Post one notice for a refusal that is not one decoded file. Never throws. */
export const note = (machine: StateRoot, notice: Omit<StoredNotice, "at">) =>
  noteStored(machine.notices, notice);

/** Rest bytes in this machine's blob store, proven by reading them back. The one blob writer. */
export const rest = (
  machine: StateRoot,
  bytes: Uint8Array | string,
): { sha256: string; blob: StatePath } => {
  const sha256 = sha256Hex(bytes);
  return { sha256, blob: restBlob(machine.blobs, sha256, Buffer.from(bytes)) };
};
/** Distinguish missing bytes, damaged bytes, and bytes that could not be read. */
export const rested = (
  machine: StateRoot,
  sha256: string,
):
  | { kind: "ok"; bytes: Buffer }
  | { kind: "missing" }
  | { kind: "corrupt" }
  | { kind: "kept"; reason: string } => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { kind: "corrupt" };
  try {
    const bytes = readFileSync(join(machine.blobs, "sha256", sha256));
    return sha256Hex(bytes) === sha256 ? { kind: "ok", bytes } : { kind: "corrupt" };
  } catch (error) {
    return errno(error) === "ENOENT"
      ? { kind: "missing" }
      : { kind: "kept", reason: message(error) };
  }
};
