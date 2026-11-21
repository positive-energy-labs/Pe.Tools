/** The host half of the declaration grammar: the bodies a product owes for what it declares. */
import type { z } from "zod";
import type { Effect, Schema } from "effect";
import type {
  BridgeSessionsListData,
  HostLocalCatalogEntry,
} from "@pe/host-contracts/operation-types";
import type { AnyReadHandle } from "./handle.ts";
import type { ProductDeclaration } from "./product.ts";
import type { SHEET_COMMANDS } from "./slots/sheet.ts";
import type { Address, DocumentRef } from "./target.ts";

type CatalogRow = HostLocalCatalogEntry<string>;
/**
 * One local operation: a host body that needs no Revit, called by key through `/call`. The entry is
 * its one declaration: the schemas, the catalog row, and for a mutation the files it writes, which
 * the action gateway admits as its footprint.
 */
export type LocalOperation = {
  readonly request?: Schema.Top;
  readonly response: Schema.Top;
  /** The catalog description. */
  readonly says: string;
  /** A read unless it says so. */
  readonly effect?: "SessionWrite";
  /**
   * A method, so each entry's own request type fits the erased table and the gateway calls it with
   * the request it has already decoded. `LocalFootprint` holds the exact type at the declaration.
   */
  effects?(input: unknown): readonly string[];
} & Pick<CatalogRow, "displayName" | "requestTypeName" | "responseTypeName" | "searchTerms"> &
  Partial<Pick<CatalogRow, "costTier">>;
/** A mutation owes the files it writes, read from its declared request; a read can name none. */
export type LocalFootprint<O> = O extends { readonly effect: "SessionWrite" }
  ? { readonly effects: (input: LocalInput<O>) => readonly string[] }
  : { readonly effects?: never };
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
  Emit extends { call: unknown; answer: unknown; needs: unknown } = never,
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
   * One body per declared host file, which a reading takes through `hostFile`: the kernel records
   * the answer as one taking, so the body may read host state a `ReadContext` cannot. `document`
   * resolves an open document's address.
   */
  readonly files?: {
    readonly [K in keyof P["files"]]: FileBody<
      Deps,
      P["files"][K] extends { readonly emits: infer Kind extends PropertyKey }
        ? Omit<z.output<P["captures"][Kind & keyof P["captures"]]>, "id">
        : unknown
    >;
  };
  /**
   * One body per reading that declares `emits`: it answers the reading's `snapshot` call and returns
   * the value to keep, of the declared kind. The kernel stores it; the body holds no store.
   */
  readonly emits?: {
    readonly [K in Emitting<P>]: (
      call: Emit["call"],
      deps: Deps,
    ) => Effect.Effect<Emit["answer"] & { readonly capture: Kept<P, K> }, unknown, Emit["needs"]>;
  };
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
/** The readings that declare `emits`, and the value each one's body returns: the kind's, less the id. */
type Emitting<P extends ProductDeclaration> = {
  [K in keyof P["readings"]]: P["readings"][K] extends { readonly emits: PropertyKey } ? K : never;
}[keyof P["readings"]];
type Kept<P extends ProductDeclaration, K extends keyof P["readings"]> = Omit<
  z.output<P["captures"][P["readings"][K]["emits"] & keyof P["captures"]]>,
  "id"
>;
type ProductRead<P extends ProductDeclaration, Reader = unknown> = {
  readonly [K in keyof P["homes"] as P["homes"][K] extends { read: "product" } ? K : never]: Reader;
};
/** A reading that declares no `emits` can have no emitting body, so an undeclared capture fails `tsc`. */
type Undeclared<P extends ProductDeclaration> = {
  readonly emits?: { readonly [K in Exclude<keyof P["readings"], Emitting<P>>]?: never };
};
/** The slot's name when the product declares a key in it, so a product with none owes no table. */
type Declares<Table, Slot extends string> = [keyof Table] extends [never] ? never : Slot;
/**
 * The tables a product owes for what it declares. Kept off `HostBodies` so that type stays one plain
 * object: `implement()` intersects this in, and a declared `http` route or local operation with no
 * body fails `tsc`.
 */
export type OwedBodies<P extends ProductDeclaration, Bodies> = Undeclared<P> &
  Required<
    Pick<
      Bodies,
      (
        | Declares<P["http"], "http">
        | Declares<P["local"], "local">
        | Declares<P["files"], "files">
        | ([Emitting<P>] extends [never] ? never : "emits")
        | Declares<ProductRead<P>, "homes">
      ) &
        keyof Bodies
    >
  >;
export type FileBody<Deps, Answer = unknown> = (
  args: unknown,
  host: {
    readonly deps: Deps;
    readonly document: (target: DocumentRef) => Promise<{ readonly address: Address | null }>;
    readonly sessions: () => Promise<BridgeSessionsListData>;
  },
) => Promise<Answer>;
