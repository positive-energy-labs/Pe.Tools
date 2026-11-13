/**
 * The functions here take bare paths. `kinds.ts` is the door over them (routes CONTRACTS K-A2):
 * a declared kind mints the path and carries the rule. The store sweeps move every caller there;
 * what is left exported here afterwards is `kinds.ts`'s own imports.
 *
 * The store kernel (ADR 0039; ADR 0037 rules 5 to 7): one atomic write for machine state, one write
 * door into a home, and one decode at the trust boundary that carries the two failure policies.
 * Nothing here throws on a file that does not decode, so no stored file can stop the host.
 *
 * Synchronous on purpose: half the callers are synchronous stores (devices, scheduled tasks, Work,
 * the host log, the outbox), and one implementation serves them and the async ones alike.
 * ponytail: sync IO blocks the loop for one small file, and a held rename for up to 775 ms; give a
 * caller an async twin only when a write is measured slow.
 */
import { createHash, randomUUID } from "node:crypto";
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
import { productPathNames } from "./contracts/product.ts";

export const sha256Hex = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

const errno = (error: unknown) => (error as NodeJS.ErrnoException).code ?? "";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Windows refuses a rename while a scanner or the indexer holds the target; the hold ends in milliseconds. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
const pause = (ms: number) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

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
const owed = new Map<string, string>();

/**
 * Machine state, no compare: a temp file in the same directory, then a rename over the target. A
 * reader sees the old bytes or the new ones, never a torn file. Creates the parent directory.
 */
export function writeAtomic(path: string, bytes: Uint8Array | string): void {
  const blobRoot = owed.get(resolve(path));
  if (blobRoot) {
    // Throws while the file is still unreadable or the copy still fails: the write is refused
    // and the kept bytes stay.
    const prior = readOrNull(path);
    if (prior) restBlob(blobRoot, sha256Hex(prior), prior);
    owed.delete(resolve(path));
  }
  mkdirSync(dirname(path), { recursive: true });
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

export type HomeWrite =
  | { ok: true; sha256: string; priorSha256: string | null; priorBlob: string | null }
  | { ok: false; kind: "conflict"; actualSha256: string | null };

/**
 * The one way to write into a home (ADR 0037 rule 5): a compare-and-swap on SHA-256.
 * `expectSha256: null` means the file must not exist. Before an overwrite the prior bytes go to
 * `<blobRoot>/sha256/<hash>` on this machine (rule 7, the safety net), and the receipt names them.
 */
export function writeHomeFile(
  path: string,
  bytes: Uint8Array | string,
  opts: { expectSha256: string | null; blobRoot: string },
): HomeWrite {
  const next = Buffer.from(bytes);
  const conflict = (actualSha256: string | null): HomeWrite => ({
    ok: false,
    kind: "conflict",
    actualSha256,
  });
  if (opts.expectSha256 === null) {
    mkdirSync(dirname(path), { recursive: true });
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
export function restBlob(blobRoot: string, sha256: string, bytes: Uint8Array): string {
  const blob = join(blobRoot, "sha256", sha256);
  const rests = () => {
    const copy = readOrNull(blob);
    return copy !== null && sha256Hex(copy) === sha256;
  };
  // A whole blob is the same bytes already; a blob torn by an earlier crash is rewritten.
  if (!rests()) {
    writeAtomic(blob, bytes);
    if (!rests()) throw Error(`The copy at '${blob}' does not read back as the bytes it was given.`);
  }
  return blob;
}

/**
 * The machine's one notice file under a product root. The host's feed reads it, and every process
 * that refuses a stored file (the host, an MCP child) posts to the same one.
 */
export const storedNoticesFile = (root: string) => join(root, "state", productPathNames.storedNoticesFileName);

/** One durable line per stored file that did not decode; the host's notice feed draws them. */
export const storedNoticeSchema = z.strictObject({
  class: z.enum(["keep", "discard"]),
  /** The Place, in words a person knows: "Work for /ducts", "Scheduled tasks". */
  place: z.string(),
  path: z.string(),
  /** Null when the bytes themselves could not be read. */
  sha256: z.string().nullable(),
  reason: z.string(),
  at: z.string(),
});
export type StoredNotice = z.infer<typeof storedNoticeSchema>;

/** Every notice posted so far. A line that does not decode is skipped: the store cannot report on itself. */
export function readStoredNotices(file: string): StoredNotice[] {
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

/**
 * `notices` is the machine's notice file (`<machine state root>/state/stored-notices.jsonl` in the
 * host). A discard must name it, so nothing is deleted without a trace; a keep may, when no listing
 * of its own shows the refusal. `parse` replaces `JSON.parse` for a file that is not one JSON value.
 * A discard loses nothing: the refused bytes rest in `<blobRoot>/sha256/<hash>` before the file
 * goes, and the notice's `sha256` is that hash. A caller that names no `blobRoot` gets the `Blobs`
 * folder beside the notice file, which is the machine's blob root (`stateTree().blobs`).
 */
export type StoredPolicy = { place: string; parse?: (text: string) => unknown } & (
  | { class: "keep"; notices?: string; blobRoot?: undefined }
  | { class: "discard"; notices: string; blobRoot?: string }
);

export type StoredRead<T> =
  | { kind: "ok"; value: T; sha256: string }
  | { kind: "missing" }
  | { kind: "kept"; reason: string }
  | { kind: "discarded"; reason: string; blob: string };

const oneLine = (why: string) => why.replace(/\s+/g, " ").slice(0, 500);

/**
 * Post one durable notice, de-duplicated by path and hash: the same bytes at the same path never
 * post twice. It never throws, because a notice that cannot be written must not stop its caller.
 * `readStored` posts through this; call it directly for a refusal that is not one decoded file
 * (a recording bundle that will not open).
 */
export function noteStored(file: string, notice: Omit<StoredNotice, "at">): void {
  try {
    const path = resolve(notice.path);
    // ponytail: a scan of an append-only file per refusal, and no pruning. A refusal is rare;
    // prune by age when the file is measured large.
    const posted = readStoredNotices(file).some(
      (row) => row.path === path && row.sha256 === notice.sha256,
    );
    if (posted) return;
    mkdirSync(dirname(file), { recursive: true });
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
function refuse(path: string, bytes: Buffer | null, policy: StoredPolicy, why: string) {
  const note = (cls: StoredPolicy["class"], reason: string) => {
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
  const kept = (reason: string) => ({ kind: "kept", reason: note("keep", oneLine(reason)) }) as const;
  if (policy.class === "keep") return kept(why);
  const blobRoot =
    policy.blobRoot ?? join(dirname(policy.notices), productPathNames.blobsDirectoryName);
  // Until the set-aside below completes, a write over this path owes its bytes a copy.
  owed.set(resolve(path), blobRoot);
  if (!bytes) return kept(why);
  let blob: string;
  try {
    blob = restBlob(blobRoot, sha256Hex(bytes), bytes);
  } catch (error) {
    return kept(`Kept, because its bytes could not be copied aside (${message(error)}). ${why}`);
  }
  try {
    // ponytail: the compare and the remove are not one step; a writer landing between them loses
    // its bytes. Ceiling: one machine, one host per state root. Take a lock file if writers grow.
    const now = readOrNull(path);
    if (now && !now.equals(bytes)) return kept(`Kept, because it changed while it was set aside. ${why}`);
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
export function readStored<T>(
  path: string,
  schema: z.ZodType<T>,
  policy: StoredPolicy,
): StoredRead<T> {
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
export function readStoredLines<T>(
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
export function appendStoredLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
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
export function discardStored(
  path: string,
  policy: Extract<StoredPolicy, { class: "discard" }>,
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
export type DerivedStore = { dir: string; notices: string; blobRoot: string };

/** What a derived file is derived from: the source bytes and the producer's identity, options included. */
export const derivedKey = (source: Uint8Array | string, producer: string) =>
  sha256Hex(`${sha256Hex(source)}
${producer}`);
export const derivedName = (key: string, bytes: Uint8Array | string) => `${key}.${sha256Hex(bytes)}`;

/** An owner refuses one derived file it decoded: discard class (ADR 0039), one notice, the bytes rest in the blob store. */
export const discardDerived = (store: DerivedStore, path: string, reason: string): void =>
  void discardStored(path, { class: "discard", place: "Derived file", notices: store.notices, blobRoot: store.blobRoot }, reason);

/**
 * The file a key names, proven by its own hash. One whose name does not match its bytes is skipped
 * with one notice and stays where it is: a reader never removes a file, and `dir` can be a folder
 * on a shared drive that another person's machine is writing.
 */
export function readDerived(store: DerivedStore, key: string): { path: string; bytes: Buffer } | null {
  let names: string[];
  try {
    names = readdirSync(store.dir);
  } catch {
    return null;
  }
  for (const name of names.filter((name) => name.startsWith(`${key}.`)).sort()) {
    const path = join(store.dir, name);
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
export function writeDerived(store: DerivedStore, key: string, bytes: Uint8Array | string): string {
  const path = join(store.dir, derivedName(key, bytes));
  const made = writeHomeFile(path, bytes, { expectSha256: null, blobRoot: store.blobRoot });
  if (!made.ok && made.actualSha256 && made.actualSha256 !== sha256Hex(bytes))
    writeHomeFile(path, bytes, { expectSha256: made.actualSha256, blobRoot: store.blobRoot });
  return path;
}
