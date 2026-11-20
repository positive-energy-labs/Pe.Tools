/** The host half of the declaration grammar: the bodies a product owes for what it declares. */
import type { z } from "zod";
import type { Schema } from "effect";
import type { BridgeSessionsListData } from "@pe/host-contracts/operation-types";
import type { AnyReadHandle } from "./handle.ts";
import type { ProductDeclaration } from "./product.ts";
import type { SHEET_COMMANDS } from "./slots/sheet.ts";
import type { Address, DocumentRef } from "./target.ts";

/** One local operation: a host body that needs no Revit, called by key through `/call`. */
type LocalOperation = { readonly request?: Schema.Top; readonly response: Schema.Top };
export type LocalOperations = Readonly<Record<string, LocalOperation>>;

type Handle<
  P extends ProductDeclaration,
  K extends keyof P["readings"],
> = P["readings"][K]["handle"];
/** One body per declared reading and per declared command. The runtime names its own context and executor. */
type ReadingBody<P extends ProductDeclaration, K extends keyof P["readings"], Context> = (
  ctx: Context,
  args: z.output<Handle<P, K>["input"]>,
) => z.output<Handle<P, K>["data"]> | Promise<z.output<Handle<P, K>["data"]>>;
/** What the kernel's route mount hands an HTTP body: the declared input, the query and the bridge target headers. */
export type HttpRequest<I = unknown> = {
  readonly input: I;
  readonly query: URLSearchParams;
  readonly session?: string;
  readonly openId?: string;
};
type LocalInput<O> = O extends { readonly request: infer S extends Schema.Top }
  ? Schema.Schema.Type<S>
  : unknown;
/**
 * `Deps` is what the host hands every body of the product, and `Run` what a local body answers with
 * (the runtime names its own effect).
 */
export type HostBodies<
  P extends ProductDeclaration,
  Context,
  Executor,
  Deps = never,
  Run = never,
  Call = never,
  Reader = never,
> = {
  /** One reader per home declared with `productRead`: what only the product can read. */
  readonly homes?: ProductRead<P, Reader>;
  readonly readings: {
    readonly [K in keyof P["readings"]]:
      | ReadingBody<P, K, Context>
      | {
          readonly name: string;
          readonly input: z.ZodType;
          readonly output: z.ZodType;
          readonly contract?: AnyReadHandle;
          readonly run: ReadingBody<P, K, Context>;
        };
  };
  /** A plan built by `workWriteCommands` is its write's body in the preview phase, so it takes none. */
  readonly commands: {
    readonly [K in keyof P["commands"] as K extends `${string}.preview` ? never : K]: Executor;
  } & (NonNullable<P["sheetWrites"]>["writes"] extends undefined
    ? unknown
    : Readonly<Record<(typeof SHEET_COMMANDS)[keyof typeof SHEET_COMMANDS], Executor>>);
  /**
   * Host files a reading takes as `file:<name>`: the kernel records the answer as one taking, so the
   * body may read host state a `ReadContext` cannot. `document` resolves an open document's address.
   */
  readonly files?: Readonly<Record<string, FileBody<Deps>>>;
  /** A native call the product answers itself, by operation key; its `snapshot` call policy names it. */
  readonly calls?: Readonly<Record<string, Call>>;
  readonly http?: {
    readonly [K in keyof P["http"]]: (
      request: HttpRequest<z.output<P["http"][K]["input"]>["body"]>,
      deps: Deps,
    ) => Promise<z.output<P["http"][K]["output"]>>;
  };
  readonly local?: {
    readonly [K in keyof P["local"]]: (input: LocalInput<P["local"][K]>, deps: Deps) => Run;
  };
};
type ProductRead<P extends ProductDeclaration, Reader = unknown> = {
  readonly [K in keyof P["homes"] as P["homes"][K] extends { read: "product" } ? K : never]: Reader;
};
/** The slot's name when the product declares a key in it, so a product with none owes no table. */
type Declares<Table, Slot extends string> = [keyof Table] extends [never] ? never : Slot;
/**
 * The tables a product owes for what it declares. Kept off `HostBodies` so that type stays one plain
 * object: `implement()` intersects this in, and a declared `http` route or local operation with no
 * body fails `tsc`.
 */
export type OwedBodies<P extends ProductDeclaration, Bodies> = Required<
  Pick<Bodies, (
      | Declares<P["http"], "http">
      | Declares<P["local"], "local">
      | Declares<ProductRead<P>, "homes">
    ) &
      keyof Bodies>
>;
export type FileBody<Deps> = (
  args: unknown,
  host: {
    readonly deps: Deps;
    readonly document: (target: DocumentRef) => Promise<{ readonly address: Address | null }>;
    readonly sessions: () => Promise<BridgeSessionsListData>;
  },
) => Promise<unknown>;
