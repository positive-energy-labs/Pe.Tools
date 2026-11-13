/** Pure stored-value contracts and content identity; I/O stays in store.ts. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { HomePath, StatePath } from "./store-paths.ts";

export const sha256Hex = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export type HomeWrite =
  | { ok: true; sha256: string; priorSha256: string | null; priorBlob: string | null }
  | { ok: false; kind: "conflict"; actualSha256: string | null };

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

/** What a derived file is derived from: the source bytes and the producer's identity, options included. */
export const derivedKey = (source: Uint8Array | string, producer: string) =>
  sha256Hex(`${sha256Hex(source)}
${producer}`);
export const derivedName = (key: string, bytes: Uint8Array | string) =>
  `${key}.${sha256Hex(bytes)}`;

/**
 * `notices` is the machine's notice file (`<machine state root>/state/stored-notices.jsonl` in the
 * host). A discard must name it, so nothing is deleted without a trace; a keep may, when no listing
 * of its own shows the refusal. `parse` replaces `JSON.parse` for a file that is not one JSON value.
 * A discard loses nothing: the refused bytes rest in `<blobRoot>/sha256/<hash>` before the file
 * goes, and the notice's `sha256` is that hash. `policyOf` supplies the kind's machine blob root;
 * there is no second default path or caller-selected preservation rule.
 */
export type ReadRule = { place: string; parse?: (text: string) => unknown } & (
  | { class: "keep"; notices?: string; blobRoot?: undefined }
  | { class: "discard"; notices: StatePath; blobRoot: StatePath }
);

export type StoredRead<T> =
  | { kind: "ok"; value: T; sha256: string }
  | { kind: "missing" }
  | { kind: "kept"; reason: string }
  | { kind: "discarded"; reason: string; blob: StatePath };

export type DerivedStore<P extends HomePath | StatePath> = {
  dir: P;
  path: (name: string) => P;
  notices: StatePath;
  blobRoot: StatePath;
};
