/**
 * Kinds (routes CONTRACTS K-A2): the door to every stored file. A kind is a declared class of
 * stored file, and it mints the file's path: `Kind.in(root, ...args)` is the only way to a
 * `StoredFile`, and every function here takes a `StoredFile`, never a string. So the place a file
 * sits and the rule it is read under cannot disagree, and what preserves its bytes is the kind,
 * never a caller's argument. The bytes move through `store.ts`, which stays the one file that
 * writes (the fs ratchet's named owner).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { productPathNames } from "./contracts/product.ts";
import type { Home } from "./product-paths.ts";
import {
  appendStoredLine,
  discardDerived,
  discardStored,
  noteStored,
  readDerived,
  readStored,
  readStoredLines,
  readStoredNotices,
  restBlob,
  sha256Hex,
  writeAtomic,
  writeDerived,
  writeHomeFile,
  type DerivedStore,
  type HomeWrite,
  type StoredNotice,
  type StoredPolicy,
  type StoredRead,
} from "./store.ts";
export { derivedKey, sha256Hex, type HomeWrite, type StoredNotice } from "./store.ts";

declare const where: unique symbol;
/** A path inside a content home. Only a home kind mints one. */
export type HomePath = string & { readonly [where]: "home" };
/** A path under this machine's `state` folder. Only `stateTree()` and a state kind mint one. */
export type StatePath = string & { readonly [where]: "state" };
/** `state-kept` is machine state that holds a person's decision: read under the keep rule. */
export type At = "home" | "state" | "state-kept";
type PathAt<A extends At> = A extends "home" ? HomePath : StatePath;

/**
 * This machine's state root, as the kernel needs it. Minted only by `stateTree()` in
 * `service-identity.ts`, the one table of machine-state paths. It carries the notice file and the
 * blob root, so no reader or writer names either.
 */
export type StateRoot = {
  readonly state: StatePath;
  readonly notices: StatePath;
  readonly blobs: StatePath;
  readonly derived: StatePath;
};
/** A proven home, bound to the machine whose blob store keeps what a write into it replaces (ADR 0037 rule 7). Minted by `stateTree(root).home(home)`. */
export type HomeRoot = Home & { readonly machine: StateRoot };
type RootAt<A extends At> = A extends "home" ? HomeRoot : StateRoot;

type KindSpec<T, Args extends readonly unknown[]> = {
  /** Words a person knows: "Work for /ducts". */
  readonly place: (...args: Args) => string;
  readonly schema: z.ZodType<T>;
  /** Path segments under the root. Each is one name: no separator, no `.` or `..`. */
  readonly segments: (...args: Args) => readonly string[];
  /** Replaces `JSON.parse` for a file that is not one JSON value. */
  readonly parse?: (text: string) => unknown;
  /** A kept file posts no notice, because its owner lists the refusal itself. Never for `state`. */
  readonly quiet?: true;
};

/** What a kind says about every file of it, whatever its arguments. */
type KindRule<T, A extends At> = {
  readonly at: A;
  readonly schema: z.ZodType<T>;
  readonly parse?: (text: string) => unknown;
  readonly quiet?: true;
};
export type Kind<T, A extends At, Args extends readonly unknown[]> = KindRule<T, A> & {
  /** The only way to a path. A home kind takes a home bound to this machine; a state kind takes the state root. */
  in(root: RootAt<A>, ...args: Args): StoredFile<T, A>;
};

/** A stored file: its kind and its path, bound together. Minted only by `Kind.in`. */
export type StoredFile<T, A extends At> = {
  readonly kind: KindRule<T, A>;
  readonly path: PathAt<A>;
  readonly place: string;
  readonly machine: StateRoot;
};

const under = <P extends string>(root: string, segments: readonly string[]): P => {
  for (const segment of segments)
    if (!segment || segment === "." || segment === ".." || /[\\/]/.test(segment))
      throw Error(`'${segment}' is not one path segment, so no stored path is made from it.`);
  return join(root, ...segments) as P;
};

function kind<A extends At>(at: A) {
  return <T, Args extends readonly unknown[] = []>(spec: KindSpec<T, Args>): Kind<T, A, Args> => {
    const made: Kind<T, A, Args> = {
      at,
      schema: spec.schema,
      parse: spec.parse,
      quiet: spec.quiet,
      in: (root, ...args) => ({
        kind: made,
        path: under<PathAt<A>>("machine" in root ? root.root : root.state, spec.segments(...args)),
        place: spec.place(...args),
        machine: "machine" in root ? root.machine : root,
      }),
    };
    return made;
  };
}
/** An authored file in a content home: never removed by a reader, written only by `writeHome`. */
export const homeKind = kind("home");
/** Machine state: a file that does not decode is set aside, its bytes kept, with one notice. */
export const stateKind = kind("state");
/** Machine state that is a person's decision (route trust, pod choices): refused and kept. */
export const keptStateKind = kind("state-kept");

export type Stored<T> =
  | { kind: "ok"; value: T; sha256: string }
  | { kind: "missing" }
  /** A home file, a `state-kept` file, or any file that could not be read or copied aside. */
  | { kind: "kept"; reason: string }
  /** State only, after the copy was verified. `blob` holds the exact bytes. */
  | { kind: "set-aside"; reason: string; blob: StatePath };

const policyOf = (file: StoredFile<unknown, At>): StoredPolicy => {
  const { parse, quiet } = file.kind;
  return file.kind.at === "state"
    ? { class: "discard", place: file.place, parse, notices: file.machine.notices, blobRoot: file.machine.blobs }
    : { class: "keep", place: file.place, parse, notices: quiet ? undefined : file.machine.notices };
};
const settled = <T>(read: StoredRead<T>): Stored<T> =>
  read.kind === "discarded"
    ? { kind: "set-aside", reason: read.reason, blob: read.blob as StatePath }
    : read;

/** Decode a stored file at the trust boundary, under its kind's rule. Never throws on a bad file. */
export function read<T>(file: StoredFile<T, "state">): Stored<T>;
export function read<T>(file: StoredFile<T, "home" | "state-kept">): Exclude<Stored<T>, { kind: "set-aside" }>;
export function read<T>(file: StoredFile<T, At>): Stored<T> {
  return settled(readStored(file.path, file.kind.schema, policyOf(file)));
}

/** The one way to write into a home: a compare-and-swap on the hash the writer read (`null`: the file must not exist). */
export function writeHome<T>(file: StoredFile<T, "home">, bytes: Uint8Array | string, expectSha256: string | null): HomeWrite {
  return writeHomeFile(file.path, bytes, { expectSha256, blobRoot: file.machine.blobs });
}

/** Write machine state atomically. Refused while kept bytes at the path still have no copy. */
export function writeState<T>(file: StoredFile<T, "state" | "state-kept">, bytes: Uint8Array | string): void {
  writeAtomic(file.path, bytes);
}

/** An owner refuses a state file it decoded (a stale identity, another epoch): set aside, one notice. */
export function setAside<T>(file: StoredFile<T, "state">, reason: string): Exclude<Stored<T>, { kind: "ok" }> {
  const policy = policyOf(file) as Extract<StoredPolicy, { class: "discard" }>;
  return settled<T>(discardStored(file.path, policy, reason)) as Exclude<Stored<T>, { kind: "ok" }>;
}

/** An append-only log in machine state, decoded one line at a time. Minted only by `LogKind.in`. */
export type StoredLog<T> = {
  readonly schema: z.ZodType<T>;
  readonly path: StatePath;
  readonly place: string;
  readonly machine: StateRoot;
};
export type LogKind<T, Args extends readonly unknown[]> = {
  in(root: StateRoot, ...args: Args): StoredLog<T>;
};
export const stateLog = <T, Args extends readonly unknown[] = []>(
  spec: Pick<KindSpec<T, Args>, "place" | "schema" | "segments">,
): LogKind<T, Args> => ({
  in: (root, ...args) => ({
    schema: spec.schema,
    path: under<StatePath>(root.state, spec.segments(...args)),
    place: spec.place(...args),
    machine: root,
  }),
});
/** Every line that decodes. A line that does not is left out with one notice and stays in the file. */
export const readLines = <T>(log: StoredLog<T>) =>
  readStoredLines(log.path, log.schema, { place: log.place, notices: log.machine.notices });
export const appendLine = <T>(log: StoredLog<T>, value: T): void =>
  appendStoredLine(log.path, JSON.stringify(value));

/** A derived folder is the one place that is a home for one caller and state for another. */
export type DerivedDir = { readonly path: HomePath | StatePath; readonly machine: StateRoot };
export type DerivedFile = { readonly path: HomePath | StatePath; readonly bytes: Uint8Array };
/** The `Derived` folder of a project home, or this machine's `state\Derived`. */
export const derivedIn = (root: HomeRoot | StateRoot): DerivedDir =>
  "machine" in root
    ? { path: under<HomePath>(root.root, [productPathNames.derivedDirectoryName]), machine: root.machine }
    : { path: root.derived, machine: root };
const derivedStoreOf = (dir: DerivedDir): DerivedStore => ({
  dir: dir.path,
  notices: dir.machine.notices,
  blobRoot: dir.machine.blobs,
});
/** The file a key names in a derived folder, proven by its own hash; see `readDerived`. */
export const readDerivedIn = (dir: DerivedDir, key: string): DerivedFile | null =>
  readDerived(derivedStoreOf(dir), key) as DerivedFile | null;
/** Write once into a derived folder; see `writeDerived`. */
export const writeDerivedIn = (dir: DerivedDir, key: string, bytes: Uint8Array | string): DerivedFile => ({
  path: writeDerived(derivedStoreOf(dir), key, bytes) as HomePath | StatePath,
  bytes: Buffer.from(bytes),
});
/** An owner refuses a derived file it decoded. In a home it is kept with a notice; in state it is set aside. */
export const refuseDerived = (dir: DerivedDir, file: DerivedFile, reason: string): void => {
  const store = derivedStoreOf(dir);
  if (dir.path === dir.machine.derived) return discardDerived(store, file.path, reason);
  noteStored(store.notices, { class: "keep", place: "Derived file", path: file.path, sha256: sha256Hex(file.bytes), reason });
};

/** The notices posted on this machine so far. */
export const notices = (machine: StateRoot) => readStoredNotices(machine.notices);
/** Post one notice for a refusal that is not one decoded file. Never throws. */
export const note = (machine: StateRoot, notice: Omit<StoredNotice, "at">) =>
  noteStored(machine.notices, notice);

/** Rest bytes in this machine's blob store, proven by reading them back. The one blob writer. */
export const rest = (machine: StateRoot, bytes: Uint8Array | string): { sha256: string; blob: StatePath } => {
  const sha256 = sha256Hex(bytes);
  return { sha256, blob: restBlob(machine.blobs, sha256, Buffer.from(bytes)) as StatePath };
};
/** The bytes that rest under a hash, or null. Bytes that do not match their hash read as null. */
export const rested = (machine: StateRoot, sha256: string): Buffer | null => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  try {
    const bytes = readFileSync(join(machine.blobs, "sha256", sha256));
    return sha256Hex(bytes) === sha256 ? bytes : null;
  } catch {
    return null;
  }
};
