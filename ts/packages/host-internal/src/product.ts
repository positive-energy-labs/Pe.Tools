import { Effect } from "effect";
import type { z } from "zod";
import { documentRefSchema, type DocumentRef, type NativeProcess } from "@pe/agent-contracts";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type {
  FileBody,
  HostBodies,
  HttpRequest,
  OwedBodies,
  ProductDeclaration,
} from "@pe/agent-contracts/product";
import type { AttemptHost } from "./action-execution.ts";
import type { RevitBridge } from "./bridge.ts";
import type { CommandExecutor } from "./command-executor.ts";
import { declareHome, type HomeFiles, type HomeReader } from "./home-files.ts";
import type { CaptureKinds } from "./kept-captures.ts";
import type { RunPods } from "./pod-runner.ts";
import { declareRetained } from "./retained-readings.ts";
import type { HostNativeRead } from "./native-read.ts";
import type { RequestIdentity } from "./request-contracts.d.ts";
import { body, leaf, type Leaf, type Read, type ReadContext } from "./reads/door.ts";

/** What a host always holds, so every product body takes it whole, on every path. */
export type HostOffer = {
  /** The kernel capture store: a product reads its declared kinds through `captured`. */
  readonly captures: { readonly kept: CaptureKinds };
  /** Where this host keeps its checkout and its state. */
  readonly roots: { readonly sourceRoot: string | null; readonly rootPath: string };
  readonly files: HomeFiles["Service"];
};
/**
 * What a host offers every product body: the offer, and what only a command holds. The host states
 * it once here; a product's dependency type takes the members it needs, so no host line depends on
 * which products are registered.
 */
export type HostOffers = HostOffer & {
  nativeRead?: HostNativeRead["Service"];
  projectLifetime?: (target: DocumentRef) => Promise<NativeProcess>;
  runPods?: RunPods;
};
/** A declared host file as a read input: its name and schemas come from the declaration. */
export const hostFile = <
  P extends Pick<ProductDeclaration, "files">,
  K extends keyof P["files"] & string,
>(
  product: P,
  key: K,
  validate = true,
) => {
  const { input, output } = product.files[key]!;
  // The declaration's schemas are held erased; the key gives the leaf their types back.
  return leaf(`file:${key}`, input, output, validate) as Leaf<
    z.output<P["files"][K]["input"]>,
    z.output<P["files"][K]["output"]>
  >;
};
type ProductHome<P extends Pick<ProductDeclaration, "homes">> = {
  [K in keyof P["homes"]]: P["homes"][K] extends { read: "product" } ? K : never;
}[keyof P["homes"]] &
  string;
/**
 * A home the product reads itself, as a read input: every tier's files for the target's project
 * home. `from` is the same input for a command, which holds the files service and the pointer.
 */
export const homeLeaf = <P extends Pick<ProductDeclaration, "homes">, T>(
  _product: P,
  key: ProductHome<P>,
  reader: HomeReader<T>,
) => ({
  ...leaf(`file:${key}`, documentRefSchema.nullable(), reader.schema),
  from: (files: HomeFiles["Service"], pointer?: string | null) =>
    Effect.map(files.home(key, pointer), (value) => reader.schema.parse(value)),
});
type Dependencies = Pick<HostOffers, "nativeRead" | "projectLifetime">;

/** A command's host body. The command registry calls it once with the services it owns. */
export type CommandBody<D = Dependencies> = (
  bridge: RevitBridge["Service"],
  deps: D,
) => CommandExecutor;
/** What a local operation's body answers with: the host's own services, and any failure. */
export type LocalRun = Effect.Effect<unknown, unknown, AttemptHost>;
/**
 * What the kernel hands and takes from an `emits` body: the `snapshot` call it answers through
 * `/call`, and the answer beside the value the kernel keeps. `selected` reads the open document.
 */
export type EmitCall = {
  call: {
    readonly target: DocumentRef;
    readonly key: string;
    readonly request: unknown;
    readonly scope: HostSessionScope;
    readonly selected: Effect.Effect<
      { readonly address?: string | null; readonly title: string } | undefined,
      unknown,
      RequestIdentity
    >;
  };
  answer: {
    readonly value: unknown;
    readonly nativeRequestId?: string;
    readonly target: { session: string; document: string | null; documentRef?: DocumentRef };
  };
  needs: HostNativeRead | RequestIdentity;
};
/** One emitting call as the call route runs it: the declared kind, its schema and the body. */
export type Emitter<D> = {
  readonly kind: string;
  readonly schema: z.ZodType<{ readonly id: string }>;
  readonly run: (
    call: EmitCall["call"],
    deps: D,
  ) => Effect.Effect<EmitCall["answer"] & { readonly capture: object }, unknown, EmitCall["needs"]>;
};

/**
 * The host half of a product: one body per declared reading, command, `http` route and local
 * operation, and one reader per home only the product can read, or `tsc` fails. Its retained
 * readings are the kernel's from here.
 */
export function implement<P extends ProductDeclaration, D = Dependencies>(
  product: P,
  bodies: HostBodies<P, ReadContext, CommandBody<D>, D, LocalRun, EmitCall, HomeReader> &
    OwedBodies<P, HostBodies<P, ReadContext, CommandBody<D>, D, LocalRun, EmitCall, HomeReader>>,
): {
  product: P;
  reads: Record<string, Read<unknown, unknown>>;
  executors: (...args: Parameters<CommandBody<D>>) => Record<string, CommandExecutor>;
  /** Outside a command the host hands these bodies the same offer, so each takes `D`. */
  http: Record<string, (request: HttpRequest, deps: D) => Promise<unknown>>;
  local: Record<string, (input: unknown, deps: D) => LocalRun>;
  files: Record<string, FileBody<D>>;
  register: () => void;
  /** By the call key each emitting reading declares with a `snapshot` policy. */
  emitters: Record<string, Emitter<D>>;
};
export function implement<D>(
  product: ProductDeclaration,
  bodies: HostBodies<
    ProductDeclaration,
    ReadContext,
    CommandBody<D>,
    D,
    LocalRun,
    EmitCall,
    HomeReader
  >,
) {
  // With its names erased a declaration emits nothing, so the table is read by reading name.
  const emitting: Readonly<Record<string, Emitter<D>["run"] | undefined>> = bodies.emits ?? {};
  const readers: Readonly<Record<string, HomeReader | undefined>> = bodies.homes ?? {};
  const homes = Object.entries(product.homes).flatMap(([key, home]) => {
    if (home.read !== "product") return [];
    const reader = readers[key];
    if (!reader) throw Error(`No host reader for home ${key}`);
    const place = home.place(key);
    return [[key, { ...reader, directory: place.at === "setting" ? place.owner : key }] as const];
  });
  const reads = Object.fromEntries(
    Object.entries(product.readings).map(([key, { handle }]) => {
      const run = bodies.readings[key];
      if (!run) throw Error(`No host body for ${handle.key}`);
      if (typeof run === "function") return [key, body(handle, run)];
      if (run.contract && (run.contract !== handle || run.name !== handle.key))
        throw Error(`Wrong host body for ${handle.key}`);
      return [key, run.contract ? run : body(handle, run.run)];
    }),
  );
  return {
    product,
    reads,
    /** The host registers these from its product list; importing a product registers nothing. */
    register() {
      for (const [key, reader] of homes) declareHome(key, reader);
      declareRetained(product);
    },
    executors: (...args: Parameters<CommandBody<D>>) =>
      Object.fromEntries(
        Object.entries(bodies.commands).map(([key, make]) => [key, make(...args)]),
      ),
    // A product that declares none passes none: `HostBodies` asks for a table only when a key exists.
    http: { ...bodies.http },
    local: { ...bodies.local },
    files: { ...bodies.files },
    emitters: Object.fromEntries(
      Object.entries(product.readings).flatMap(([name, { emits, load }]) => {
        if (emits === undefined) return [];
        const run = emitting[name];
        const schema = product.captures[emits];
        if (!run || !schema) return [];
        return Object.entries(load?.calls ?? {})
          .filter(([, policy]) => policy?.snapshot)
          .map(([key]) => [key, { kind: emits, schema, run }]);
      }),
    ),
  };
}
