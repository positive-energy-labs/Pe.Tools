/** A kind binds location, decode and preservation. Only Kind.in mints a StoredFile. */
import { join } from "node:path";
import type { z } from "zod";
import { productPathNames } from "./contracts/product.ts";
import type { Home } from "./product-paths.ts";
export {
  derivedKey,
  derivedName,
  storedNoticeSchema,
  sha256Hex,
  read,
  writeHome,
  writeState,
  setAside,
  readLines,
  appendLine,
  appendLinesBounded,
  readDerivedIn,
  writeDerivedIn,
  refuseDerived,
  notices,
  note,
  rest,
  rested,
  type HomeWrite,
  type StoredNotice,
} from "./store.ts";
export { writeGenerated } from "./store.ts";

const mintToken = Symbol("kind-mint");
let mintGenerated: (root: string, segments: readonly string[]) => GeneratedFile;
/** Disposable build output, outside content homes and product state. Only its kind mints a file. */
export class GeneratedFile {
  readonly #brand = true;
  readonly path: string;
  private constructor(token: typeof mintToken, path: string) {
    if (token !== mintToken) throw Error("Generated output requires a kind-minted file.");
    this.path = path;
    Object.freeze(this);
  }
  static {
    mintGenerated = (root, segments) => new GeneratedFile(mintToken, under(root, segments));
  }
  static assert(file: unknown): void {
    if (typeof file !== "object" || file === null || !(#brand in file))
      throw Error("Generated output requires a kind-minted file.");
  }
}
Object.freeze(GeneratedFile);
export const generatedKind = (segments: readonly string[]) => ({
  in: (root: string): GeneratedFile => mintGenerated(root, segments),
});

import { mintHomePath, mintStatePath, type HomePath, type StatePath } from "./store-paths.ts";
export type { HomePath, StatePath } from "./store-paths.ts";
/** `state-kept` is machine state that holds a person's decision: read under the keep rule. */
export type At = "home" | "state" | "state-kept";
type PathAt<A extends At> = { home: HomePath; state: StatePath; "state-kept": StatePath }[A];

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
  readonly work: StatePath;
  readonly pages: StatePath;
  readonly runs: StatePath;
  readonly podlessRuns: StatePath;
  readonly t3: StatePath;
  readonly agent: StatePath;
  readonly apsCredentials: StatePath;
  readonly apsTokens: StatePath;
  readonly harnessThreads: StatePath;
  readonly ductsAnalyses: StatePath;
  readonly peaWork: StatePath;
  readonly providers: StatePath;
  readonly homesConfig: StatePath;
  readonly pluginDecisions: StatePath;
  readonly shippedPods: StatePath;
};
/** A proven home, bound to the machine whose blob store keeps what a write into it replaces (ADR 0037 rule 7). Minted by `stateTree(root).home(home)`. */
export type HomeRoot = Home & { readonly machine: StateRoot };
/** A named folder of machine state, minted by stateTree().directory(). */
export type StateDirectory = { readonly path: StatePath; readonly machine: StateRoot };
type RootAt<A extends At> = {
  home: HomeRoot;
  state: StateRoot | StateDirectory;
  "state-kept": StateRoot | StateDirectory;
}[A];

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
let mintStored: <T, A extends At>(
  kind: KindRule<T, A>,
  binding: { path: PathAt<A>; machine: StateRoot },
  place: string,
) => StoredFile<T, A>;
export class StoredFile<T, A extends At> {
  readonly #brand = true;
  readonly kind: KindRule<T, A>;
  readonly path: PathAt<A>;
  readonly place: string;
  readonly machine: StateRoot;
  private constructor(
    token: typeof mintToken,
    kind: KindRule<T, A>,
    path: PathAt<A>,
    place: string,
    machine: StateRoot,
  ) {
    if (token !== mintToken) throw Error("Stored I/O requires a kind-minted file.");
    this.kind = kind;
    this.path = path;
    this.place = place;
    this.machine = machine;
    Object.freeze(this);
  }
  static {
    mintStored = (kind, binding, place) =>
      new StoredFile(mintToken, kind, binding.path, place, binding.machine);
  }
  static assert(file: unknown, at?: readonly At[]): void {
    if (
      typeof file !== "object" ||
      file === null ||
      !(#brand in file) ||
      (at && !at.includes(file.kind.at))
    )
      throw Error("Stored I/O requires a kind-minted file of the right class.");
  }
}
Object.freeze(StoredFile);

const under = (root: string, segments: readonly string[]): string => {
  for (const segment of segments)
    if (!segment || segment === "." || segment === ".." || /[\\/]/.test(segment))
      throw Error(`'${segment}' is not one path segment, so no stored path is made from it.`);
  return join(root, ...segments);
};

function kind<T, A extends At, Args extends readonly unknown[]>(
  at: A,
  spec: KindSpec<T, Args>,
  bind: (root: RootAt<A>, segments: readonly string[]) => { path: PathAt<A>; machine: StateRoot },
): Kind<T, A, Args> {
  const made: Kind<T, A, Args> = {
    at,
    schema: spec.schema,
    parse: spec.parse,
    quiet: spec.quiet,
    in: (root, ...args) =>
      mintStored(made, bind(root, spec.segments(...args)), spec.place(...args)),
  };
  return Object.freeze(made);
}
/** Authored bytes, never removed by a reader. */
export const homeKind = <T, Args extends readonly unknown[] = []>(spec: KindSpec<T, Args>) =>
  kind("home", spec, (root, segments) => ({
    path: mintHomePath(under(root.root, segments)),
    machine: root.machine,
  }));
/** Machine state, set aside only after its bytes are kept. */
export const stateKind = <T, Args extends readonly unknown[] = []>(spec: KindSpec<T, Args>) =>
  kind("state", spec, (root, segments) => ({
    path: mintStatePath(under("path" in root ? root.path : root.state, segments)),
    machine: "machine" in root ? root.machine : root,
  }));
/** A person's decision in machine state, refused and kept. */
export const keptStateKind = <T, Args extends readonly unknown[] = []>(spec: KindSpec<T, Args>) =>
  kind("state-kept", spec, (root, segments) => ({
    path: mintStatePath(under("path" in root ? root.path : root.state, segments)),
    machine: "machine" in root ? root.machine : root,
  }));

export type Stored<T> =
  | { kind: "ok"; value: T; sha256: string }
  | { kind: "missing" }
  /** A home file, a `state-kept` file, or any file that could not be read or copied aside. */
  | { kind: "kept"; reason: string }
  /** State only, after the copy was verified. `blob` holds the exact bytes. */
  | { kind: "set-aside"; reason: string; blob: StatePath };

/** An append-only log in machine state, decoded one line at a time. Minted only by `LogKind.in`. */
export type StoredLog<T> = {
  readonly schema: z.ZodType<T>;
  readonly path: StatePath;
  readonly place: string;
  readonly machine: StateRoot;
};
export type LogKind<T, Args extends readonly unknown[]> = {
  in(root: StateRoot | StateDirectory, ...args: Args): StoredLog<T>;
};
export const stateLog = <T, Args extends readonly unknown[] = []>(
  spec: Pick<KindSpec<T, Args>, "place" | "schema" | "segments">,
): LogKind<T, Args> => ({
  in: (root, ...args) => ({
    schema: spec.schema,
    path: mintStatePath(under("path" in root ? root.path : root.state, spec.segments(...args))),
    place: spec.place(...args),
    machine: "machine" in root ? root.machine : root,
  }),
});

/** A derived folder is the one place that is a home for one caller and state for another. */
export type DerivedDir<P extends HomePath | StatePath = HomePath | StatePath> = {
  readonly path: P;
  readonly machine: StateRoot;
  readonly file: (name: string) => P;
};
export type DerivedFile<P extends HomePath | StatePath = HomePath | StatePath> = {
  readonly path: P;
  readonly bytes: Buffer;
};
const derivedDir = <P extends HomePath | StatePath>(
  path: P,
  machine: StateRoot,
  mint: (path: string) => P,
): DerivedDir<P> => ({ path, machine, file: (name) => mint(under(path, [name])) });
/** The Derived folder of a project home, or this machine's state. */
export function derivedIn(root: HomeRoot): DerivedDir<HomePath>;
export function derivedIn(root: StateRoot): DerivedDir<StatePath>;
export function derivedIn(root: HomeRoot | StateRoot): DerivedDir;
export function derivedIn(root: HomeRoot | StateRoot): DerivedDir {
  return "machine" in root
    ? derivedDir(
        mintHomePath(under(root.root, [productPathNames.derivedDirectoryName])),
        root.machine,
        mintHomePath,
      )
    : derivedDir(root.derived, root, mintStatePath);
}
