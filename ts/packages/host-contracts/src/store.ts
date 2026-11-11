/**
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
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

export const sha256Hex = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

const errno = (error: unknown) => (error as NodeJS.ErrnoException).code ?? "";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const readOrNull = (path: string): Buffer | null => {
  try {
    return readFileSync(path);
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    throw error;
  }
};

/** Windows refuses a rename while a scanner or the indexer holds the target; the hold ends in milliseconds. */
const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);
const pause = (ms: number) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Machine state, no compare: a temp file in the same directory, then a rename over the target. A
 * reader sees the old bytes or the new ones, never a torn file. Creates the parent directory.
 */
export function writeAtomic(path: string, bytes: Uint8Array | string): void {
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
  const priorBlob = join(opts.blobRoot, "sha256", opts.expectSha256);
  mkdirSync(dirname(priorBlob), { recursive: true });
  try {
    writeFileSync(priorBlob, prior, { flag: "wx" });
  } catch (error) {
    if (errno(error) !== "EEXIST") throw error;
    // A blob torn by an earlier crash is rewritten; a whole one is the same bytes already.
    if (sha256Hex(readFileSync(priorBlob)) !== opts.expectSha256) writeAtomic(priorBlob, prior);
  }
  // ponytail: the compare above and the rename below are not one step. Two processes on this
  // machine can both pass the compare and the later rename wins; the loser's bytes are still in
  // the blob store. Ceiling: one machine, rare. A race across machines belongs to Drive, which
  // keeps both as revisions or a conflict copy. Take a lock file here if same-machine writers grow.
  writeAtomic(path, next);
  return { ok: true, sha256: sha256Hex(next), priorSha256, priorBlob };
}

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
 */
export type StoredPolicy = { place: string; parse?: (text: string) => unknown } & (
  | { class: "keep"; notices?: string }
  | { class: "discard"; notices: string }
);

export type StoredRead<T> =
  | { kind: "ok"; value: T; sha256: string }
  | { kind: "missing" }
  | { kind: "kept"; reason: string }
  | { kind: "discarded"; reason: string };

/** Apply a class to bytes that were refused: one notice per path and hash, then delete if `discard`. */
function refuse(path: string, bytes: Buffer | null, policy: StoredPolicy, why: string) {
  const reason = why.replace(/\s+/g, " ").slice(0, 500);
  if (policy.notices)
    try {
      const notice = { path: resolve(path), sha256: bytes && sha256Hex(bytes) };
      // ponytail: a scan of an append-only file per refusal, and no pruning. A refusal is rare;
      // prune by age when the file is measured large.
      const posted = readStoredNotices(policy.notices).some(
        (row) => row.path === notice.path && row.sha256 === notice.sha256,
      );
      if (!posted) {
        mkdirSync(dirname(policy.notices), { recursive: true });
        const row: StoredNotice = {
          class: policy.class,
          place: policy.place,
          ...notice,
          reason,
          at: new Date().toISOString(),
        };
        appendFileSync(policy.notices, `${JSON.stringify(row)}\n`);
      }
    } catch (error) {
      console.warn(`Could not post the notice for '${path}': ${message(error)}`);
    }
  if (policy.class === "keep") return { kind: "kept", reason } as const;
  try {
    rmSync(path, { force: true });
  } catch {
    // A held file stays; its notice is already posted and does not repeat.
  }
  return { kind: "discarded", reason } as const;
}

/**
 * Decode a stored file at the trust boundary (ADR 0039 rule 1). `keep`: an authored file that does
 * not decode is refused, its bytes are never touched, and the reason comes back. `discard`: the
 * file is deleted with one notice. Only a missing file reads as `missing`.
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

/** Discard a file its owner refused after decoding (a stale identity, an unsupported epoch). */
export function discardStored(
  path: string,
  policy: Extract<StoredPolicy, { class: "discard" }>,
  reason: string,
): void {
  const bytes = readOrNull(path);
  if (bytes) refuse(path, bytes, policy, reason);
}
