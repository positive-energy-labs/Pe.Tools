/** Pure stored-value contracts and content identity; I/O stays in store.ts. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { At, StoredFile, Stored, DerivedDir } from "./kinds.ts";
import type { HomePath, StatePath } from "./store-paths.ts";

export const sha256Hex = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export type HomeWrite =
  | { ok: true; sha256: string; priorSha256: string | null; priorBlob: string | null }
  | { ok: false; kind: "conflict"; actualSha256: string | null };

/** Durable file findings and outward sends; the host's notice feed draws them. */
export const storedNoticeSchema = z.strictObject({
  class: z.enum(["keep", "discard", "sent"]),
  /** The Place, in words a person knows: "Scheduled tasks". */
  place: z.string(),
  documentKey: z.string().optional(),
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

export const derivedStoreOf = <P extends HomePath | StatePath>(
  dir: DerivedDir<P>,
): DerivedStore<P> => ({
  dir: dir.path,
  path: dir.file,
  notices: dir.machine.notices,
  blobRoot: dir.machine.blobs,
});

export function policyOf(
  file: StoredFile<unknown, "state">,
): Extract<ReadRule, { class: "discard" }>;
export function policyOf(
  file: StoredFile<unknown, "home" | "state-kept">,
): Extract<ReadRule, { class: "keep" }>;
export function policyOf(file: StoredFile<unknown, At>): ReadRule;
export function policyOf(file: StoredFile<unknown, At>): ReadRule {
  const { parse, quiet } = file.kind;
  return file.kind.at === "state"
    ? {
        class: "discard",
        place: file.place,
        parse,
        notices: file.machine.notices,
        blobRoot: file.machine.blobs,
      }
    : {
        class: "keep",
        place: file.place,
        parse,
        notices: quiet ? undefined : file.machine.notices,
      };
}
export function settled(
  read: Exclude<StoredRead<never>, { kind: "ok" }>,
): Exclude<Stored<never>, { kind: "ok" }>;
export function settled<T>(read: StoredRead<T>): Stored<T>;
export function settled<T>(read: StoredRead<T>): Stored<T> {
  return read.kind === "discarded"
    ? { kind: "set-aside", reason: read.reason, blob: read.blob }
    : read;
}

/** Decode without I/O; the store owns each refused line's notice and preservation. */
export function decodeLogLines<T>(text: string, schema: z.ZodType<T>) {
  const values: T[] = [];
  const problems: { line: string; reason: string }[] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let why: string;
    try {
      const parsed = schema.safeParse(JSON.parse(line));
      if (parsed.success) return void values.push(parsed.data);
      why = z.prettifyError(parsed.error);
    } catch (error) {
      why = error instanceof Error ? error.message : String(error);
    }
    problems.push({ line, reason: `Line ${index + 1} is left out: ${why}` });
  });
  return { values, problems };
}
