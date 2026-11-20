/**
 * The product declaration kernel (ruling 1 of docs/features/routes/MAP.md): one value per product at
 * `ts/products/<p>/contract/src/product.ts`. Until S9 the generator finds it by the contract package's
 * `./product` export; from S9 it finds it by path, and the export stops being a switch. The host binds it with `implement()`
 * (`@pe/host-internal/product`) and the web with `screen()` (`@pe/web-kernel/route/screen`), and a
 * missing or extra body is a compile error. Runtime-neutral: nothing here imports a host or web package.
 */
import { z } from "zod";
import type { Schema } from "effect";
import type { HttpRead } from "./pe-api.ts";
import type { AnyOperationKey, BridgeSessionsListData } from "@pe/host-contracts/operation-types";
import type { Address, DocumentRef } from "./target.ts";
import type { HostOperationKey } from "@pe/host-contracts/operation-types";
import type { Command, Tool } from "./command.ts";
import type { CallPolicy } from "./call-policy.ts";
import type { CellKey, Home } from "./product-homes.ts";
import { draftCellSchema } from "./draft.ts";
import type { AnyReadHandle, ReadHandle } from "./handle.ts";
import { hostRead, read, type field, type HostRead } from "./route.ts";
import type { RouteGraphWire } from "./route-kernel-data.ts";
import type { RouteStateSpec } from "./route-state.ts";
import {
  SHEET_COMMANDS,
  schemaOf,
  type Domain,
  type DomainValue,
  type Placement,
} from "./slots/sheet.ts";
import { sheetWritesFor } from "./slots/sheet-command.ts";
import { defineSettingOwners } from "./setting-owners.ts";
import { subjectRefCodeSchema, type SubjectRefCode } from "./subject-ref.ts";
import { writeSettingTier } from "./tiered-setting.ts";
import { writeIntentSchema } from "./write-intent.ts";
import type { Publication } from "./value.ts";

/** Unexported, so only cell() makes a cell. */
const made: unique symbol = Symbol("declared");

export * from "./product-homes.ts";

/**
 * One staged value family, with its ADR 0032 value domain; the schema follows from `schemaOf`. The
 * cell list builds the Work schema, and no cell names a home: a command's `writes` does.
 */
export type Cell<D extends Domain = Domain, K extends CellKey = CellKey> = {
  readonly [made]: "cell";
  readonly domain: D;
  readonly per: K;
  readonly label?: string;
  readonly default?: DomainValue<D>;
  readonly deletable?: true;
  readonly record?: SubjectRecord;
};
type CellOptions<D extends Domain, K extends CellKey> = Pick<Cell<D, K>, "label" | "default"> & {
  deletable?: K extends "route" ? never : true;
  record?: K extends "route" ? never : SubjectRecord;
};
export function cell<
  const D extends Domain,
  const K extends CellKey,
  const Options extends CellOptions<D, K> = {},
>(domain: D, per: K, draw?: Options): Cell<D, K> & Options;
export function cell(domain: Domain, per: CellKey, draw: CellOptions<Domain, CellKey> = {}): Cell {
  return { ...draw, [made]: "cell", domain, per };
}
type Homes = Readonly<Record<string, Home>>;
type Cells = Readonly<Record<string, Cell>>;
const single = <S extends z.ZodType>(schema: S) => draftCellSchema(schema).default({});
type SubjectRecord = <S extends z.ZodType>(value: S) => z.ZodRecord<z.ZodType<string>, S>;
const subjectRecord = <S extends z.ZodType>(value: S) => z.record(subjectRefCodeSchema, value);
const byName = <S extends z.ZodType>(schema: S) => z.record(z.string(), schema);
const keyed = <S extends z.ZodType>(schema: S, record: SubjectRecord) =>
  record(draftCellSchema(schema)).default({});
const deletableKeyed = <S extends z.ZodType>(schema: S, record: SubjectRecord) =>
  record(draftCellSchema(schema, { deletable: true })).default({});
type Schema<C extends Cell> = z.ZodType<DomainValue<C["domain"]>>;
type WorkShape<C extends Cells> = {
  -readonly [K in keyof C]: C[K]["per"] extends "route"
    ? ReturnType<typeof single<Schema<C[K]>>>
    : C[K]["deletable"] extends true
      ? ReturnType<typeof deletableKeyed<Schema<C[K]>>>
      : ReturnType<typeof keyed<Schema<C[K]>>>;
};
/** What Pea may edit is every cell, so no second list can name a cell the schema lacks. */
export type EditablePath<C extends Cells> = {
  [K in keyof C & string]: C[K]["per"] extends "route" ? readonly [K] : readonly [K, "*"];
}[keyof C & string];
// `Object.entries` keeps no key types, so these two overloads state what the cell list builds.
export function workSchema<C extends Cells>(
  cells: C,
  subjectRecord?: SubjectRecord,
): z.ZodObject<WorkShape<C>, z.core.$strict>;
export function workSchema(cells: Cells, record: SubjectRecord = subjectRecord) {
  return z.strictObject(
    Object.fromEntries(
      Object.entries(cells).map(([name, { domain, per, deletable, record: custom }]) => {
        const schema = schemaOf(domain);
        const row = custom ?? (per === "subject" ? record : byName);
        return [
          name,
          per === "route"
            ? single(schema)
            : deletable
              ? deletableKeyed(schema, row)
              : keyed(schema, row),
        ];
      }),
    ),
  );
}
function editable<C extends Cells>(cells: C): readonly EditablePath<C>[];
function editable(cells: Cells): readonly (readonly string[])[] {
  return Object.entries(cells).map(([name, { per }]) => (per === "route" ? [name] : [name, "*"]));
}

/**
 * One Work per route, for a product of several routes (G7: Work stays route-scoped). Each holds the
 * cells its route names and `writeIntent`, where `workWriteCommands` stages a sealed command's input.
 */
type RouteWorks<C extends Cells> = Readonly<Record<string, readonly (keyof C & string)[]>>;
type RouteWork<C extends Cells> = RouteStateSpec<
  z.ZodObject<
    WorkShape<C> & { writeIntent: z.ZodDefault<typeof writeIntentSchema> },
    z.core.$strict
  >
> & {
  readonly editable: readonly (EditablePath<C> | readonly ["writeIntent", "*"])[];
  readonly schemaVersion: number;
};
type RouteTools<C extends Cells, W extends RouteWorks<C>> = {
  readonly [K in keyof W]: Tool & { readonly work: RouteWork<Pick<C, W[K][number]>> };
};
/** One tool per Work: the commands staged in it. Every command of such a product is staged in one. */
function routeTools(
  says: string,
  cells: Cells,
  works: RouteWorks<Cells>,
  commands: Readonly<Record<string, Command>>,
) {
  for (const [key, { work }] of Object.entries(commands))
    if (!work || !Object.hasOwn(works, work.route))
      throw Error(`${key} is staged in no declared Work`);
  return Object.fromEntries(
    Object.entries(works).map(([route, names]) => {
      const own = Object.fromEntries(
        Object.entries(cells).filter(([name]) => names.includes(name)),
      );
      return [
        route,
        {
          name: route,
          says,
          work: {
            route,
            title: route,
            description: says,
            schemaVersion: 1,
            schema: z.strictObject({
              writeIntent: writeIntentSchema.default({}),
              ...workSchema(own).shape,
            }),
            editable: [["writeIntent", "*"], ...editable(own)],
          },
          commands: Object.fromEntries(
            Object.entries(commands).filter(([, command]) => command.work?.route === route),
          ),
        },
      ];
    }),
  );
}

/** Load policy (S6 owns the meaning). Absent is today's behaviour. */
export type ReadingLoad = Readonly<{
  alone?: true;
  freshBy?: readonly ["document-mark"];
  slow?: string;
  calls?: Readonly<Partial<Record<AnyOperationKey, CallPolicy>>>;
  resource?: true;
  basisHeaders?: Readonly<Record<string, string>>;
}>;
export type Reading<Source extends PropertyKey = string> = {
  readonly handle: ReadHandle;
  /** The product's homes this reading reads, by name. */
  readonly sources: readonly Source[];
  readonly load?: ReadingLoad;
  /** One sentence for Pea's read discovery. */
  readonly says?: string;
  readonly timelineRoute?: string;
};
/** The cells one home can take, by name. */
type Lands<H extends Home, C extends Cells> = {
  [K in keyof C]: C[K]["per"] extends H["takes"][number] ? K : never;
}[keyof C];
/**
 * Every home the command touches, each with the cells it lands there (the owner's `lands` ruling).
 * A cell no command lands stays in Work. S11 refuses a write to a home missing from this map.
 */
type Writes<H extends Homes, C extends Cells> = {
  readonly [N in keyof H]?: readonly Lands<H[N], C>[];
};
export type ProductCommand<H extends Homes = Homes, C extends Cells = Cells> = Command & {
  readonly native: readonly HostOperationKey[];
  readonly writes: Writes<H, C>;
};
/** A cell lands in at most one home across every command, so the homes table can name it (S5). */
type LandsIn<M, K> = {
  [N in keyof M]: M[N] extends { writes: infer W }
    ? {
        [Hn in keyof W]: K extends (NonNullable<W[Hn]> & readonly unknown[])[number] ? Hn : never;
      }[keyof W]
    : never;
}[keyof M];
type IsUnion<T, U = T> = [T] extends [never]
  ? false
  : T extends unknown
    ? [U] extends [T]
      ? false
      : true
    : never;
type Sole<M, C> = { [K in keyof C]: IsUnion<LandsIn<M, K>> extends true ? never : K }[keyof C];

type ResourceInput<R> = {
  [K in keyof R]: R[K] extends { load: { resource: true }; handle: { input: infer I } } ? I : never;
}[keyof R];
function resourceInputs<R extends Readings>(readings: R): readonly ResourceInput<R>[];
function resourceInputs(readings: Readings) {
  return Object.values(readings).flatMap(({ handle, load }) =>
    load?.resource ? [handle.input] : [],
  );
}

/** A declared reading by name, alone or with the function that makes its arguments from the Page. */
type Named<R extends string = string> = R | readonly [R, (page: never) => unknown];
/**
 * Address fields, subject and readings by name; `product()` builds each `HostRead`, so a route reads
 * nothing the host need not serve. `screen()` checks the rest against the kernel's specification, and
 * `panes` names every pane it must draw, no more and no fewer.
 */
export type ProductRoute<R extends string = string> = {
  readonly name: string;
  readonly directory: RouteGraphWire["directory"];
  readonly fields: Readonly<Record<string, ReturnType<typeof field>>>;
  readonly subject?: {
    readonly field: string;
    readonly noun: string;
    readonly pane: string;
    readonly read?: Named<R>;
    readonly options?: (data: never) => readonly { id: SubjectRefCode; label: string }[];
  };
  readonly core?: Named<R>;
  readonly reads?: Readonly<Record<string, Named<R>>>;
  readonly panes: readonly string[];
  readonly captureSubject?: string;
  readonly demoPlace?: { readonly id: string; readonly link: string };
};
type Readings = Readonly<Record<string, Reading<PropertyKey>>>;
type DataOf<R extends Readings, N> = z.output<
  R[(N extends readonly [infer K, unknown] ? K : N) & keyof R]["handle"]["data"]
>;
type Bound<R extends Readings, N> = HostRead & {
  readonly output: z.ZodType<Publication<DataOf<R, N>>>;
  readonly args: N extends readonly [unknown, infer A] ? A : () => {};
};
type BoundRoute<R extends Readings, Route> = {
  readonly [K in keyof Route as K extends "subject"
    ? NonNullable<Route[K]> extends { readonly field: string }
      ? K
      : never
    : K]: K extends "core"
    ? Bound<R, Route[K]>
    : K extends "reads"
      ? { readonly [N in keyof Route[K]]: Bound<R, Route[K][N]> }
      : K extends "subject"
        ? { readonly [S in keyof Route[K]]: S extends "read" ? Bound<R, Route[K][S]> : Route[K][S] }
        : Route[K];
};
type BoundRoutes<R extends Readings, Routes> = {
  readonly [K in keyof Routes]: BoundRoute<R, Routes[K]> & { readonly key: K };
};
// `Object.entries` keeps no key types, so the overload states what the route list builds.
function bind<R extends Readings, Routes>(readings: R, routes: Routes): BoundRoutes<R, Routes>;
function bind(readings: Readings, routes: Readonly<Record<string, ProductRoute>>) {
  const one = (named: Named) => {
    const [name, args] = typeof named === "string" ? [named] : named;
    const reading = readings[name];
    if (!reading) throw Error(`No reading ${name}`);
    const handle = hostRead(reading.handle);
    if (!reading.load) return read(handle, args);
    const { alone, freshBy, slow } = { ...handle.load, ...reading.load };
    return read({ ...handle, load: { alone, freshBy, slow } }, args);
  };
  return Object.fromEntries(
    Object.entries(routes).map(([key, { core, reads, subject, ...route }]) => [
      key,
      {
        ...route,
        key,
        ...(core && { core: one(core) }),
        ...(reads && {
          reads: Object.fromEntries(
            Object.entries(reads).map(([pane, named]) => [pane, one(named)]),
          ),
        }),
        ...(subject && {
          subject: { ...subject, ...(subject.read && { read: one(subject.read) }) },
        }),
      },
    ]),
  );
}
/** Judgment text only: what no schema can say. */
export type Guide = {
  readonly instructions: string;
  readonly skills: readonly { readonly name: string; readonly content: string }[];
};
/** A declaration with its names erased: what a binder or a product list holds. */
export type ProductDeclaration = {
  readonly id: string;
  readonly says: string;
  readonly homes: Homes;
  readonly cells: Cells;
  readonly readings: Readonly<Record<string, Reading>>;
  readonly commands: Readonly<Record<string, ProductCommand>>;
  readonly sheetWrites?: SheetNative & {
    readonly route: string;
    readonly writes: ProductCommand["writes"];
  };
  readonly routes: Readonly<
    Record<string, { readonly key: string } & Pick<ProductRoute, "captureSubject" | "demoPlace">>
  >;
  readonly guide?: Guide;
  readonly http: Readonly<Record<string, HttpRead>>;
  readonly local: LocalOperations;
};
/** One local operation: a host body that needs no Revit, called by key through `/call`. */
type LocalOperation = { readonly request?: Schema.Top; readonly response: Schema.Top };
type LocalOperations = Readonly<Record<string, LocalOperation>>;
type SheetNative = {
  readonly native?: Readonly<Partial<Record<"plan" | "apply", readonly HostOperationKey[]>>>;
};
type Stored = Pick<ProductDeclaration, "homes" | "cells" | "commands" | "sheetWrites">;
/** Platform commands and product commands use the same home-to-cells map. */
export const productWrites = ({
  homes,
  cells,
  commands,
  sheetWrites,
}: Stored): Readonly<Record<string, ProductCommand["writes"]>> => ({
  ...Object.fromEntries(Object.entries(commands).map(([key, { writes }]) => [key, writes])),
  ...sheetWritesFor(sheetWrites?.writes),
  [writeSettingTier.key]: Object.fromEntries(
    Object.entries(homes).flatMap(([name, home]) => {
      const settings = home.settingCells?.filter((cell) => cells[cell]?.per === "route");
      return settings?.length ? [[name, settings]] : [];
    }),
  ),
});
/** The home each cell lands in. A cell with no writer stays in Work. */
export function landings(declared: Stored): Readonly<Record<string, string>> {
  const lands = new Map<string, string>();
  for (const writes of Object.values(productWrites(declared)))
    for (const [home, cells] of Object.entries(writes))
      for (const name of cells ?? []) {
        const previous = lands.get(name);
        if (previous !== undefined && previous !== home)
          throw Error(`Cell ${name} lands in both ${previous} and ${home}`);
        lands.set(name, home);
      }
  return Object.fromEntries(lands);
}
/**
 * The sheet's bindings by cell name, each placed by the home it lands in. The web adds how a cell is
 * drawn; it names no home (the owner's ruling against a home on the binding).
 */
export const sheetCells = (declared: Stored) => {
  const lands = landings(declared);
  return Object.fromEntries(
    Object.entries(declared.cells).map(([name, { domain, per, label, default: fallback }]) => {
      const home: Placement = declared.homes[lands[name] ?? ""]?.place(name) ?? { at: "local" };
      return [name, { domain, per, label, default: fallback, home }];
    }),
  );
};

/** Refuses a key the declaration does not have, even through a variable or a spread. */
export type NoExtras<Actual, Expected> = Record<Exclude<keyof Actual, keyof Expected>, never>;
const noGuide: Guide = { instructions: "", skills: [] };
type Declared = Pick<ProductDeclaration, "says" | "cells" | "commands"> & {
  readonly works?: RouteWorks<Cells>;
};
function toolTable<
  K extends string,
  T,
  Publish extends boolean,
  C extends Cells,
  W extends RouteWorks<C>,
>(
  id: string,
  alias: K | undefined,
  value: T,
  publish: Publish | undefined,
  declared: Declared & { readonly cells: C; readonly works?: W },
): [keyof W] extends [never]
  ? Publish extends false
    ? Record<never, never>
    : { readonly [P in K]: T }
  : RouteTools<C, W>;
function toolTable(
  id: string,
  alias: string | undefined,
  value: unknown,
  publish: boolean | undefined,
  declared: Declared,
) {
  if (declared.works)
    return routeTools(declared.says, declared.cells, declared.works, declared.commands);
  return publish === false ? {} : { [alias ?? id]: value };
}

/**
 * The sheet names its Work by route and may hold only that Work's cells. A product of one Work
 * routes by its id, and its Work holds every cell.
 */
type SheetWrites<Id, H, Sheet, Works extends RouteWorks<Cells>> = keyof Works extends never
  ? { readonly route: Id; readonly writes: Sheet & NoExtras<NonNullable<Sheet>, H> }
  : {
      readonly [R in keyof Works & string]: {
        readonly route: R;
        readonly writes: Sheet &
          NoExtras<NonNullable<Sheet>, H> & {
            readonly [N in keyof Sheet]?: readonly Works[R][number][];
          };
      };
    }[keyof Works & string];

/** The declaration, plus what derives from it: the Work, Pea's tool, the named reads and the guide. */
export function product<
  const Id extends string,
  const H extends Homes,
  const C extends Cells,
  const R extends Readonly<Record<string, Reading<keyof H>>>,
  const M extends Readonly<Record<string, ProductCommand<H, C>>>,
  const Routes extends Readonly<Record<string, ProductRoute<keyof R & string>>>,
  const Publish extends boolean = true,
  const ToolName extends string = Id,
  const Sheet extends Writes<H, C> | undefined = undefined,
  const Works extends RouteWorks<C> = Record<never, never>,
  const Http extends Readonly<Record<string, HttpRead>> = Record<never, never>,
  const Local extends LocalOperations = Record<never, never>,
>(declaration: {
  /** The product folder, Work route and default name of its Pea tool. */
  readonly id: Id;
  readonly says: string;
  /** Only the product's own. A platform home follows from the nouns a product uses. */
  readonly homes: H;
  readonly cells: C;
  readonly work?: Pick<
    RouteStateSpec<z.ZodObject>,
    "title" | "settingsOwners" | "schemaVersion" | "retired" | "finds"
  > & {
    readonly subjectRecord?: SubjectRecord;
  };
  /** Only for a product of several routes: each Work by its route, with the cells it holds. */
  readonly works?: Works;
  readonly readings: R & {
    readonly [K in keyof R]: R[K] extends { load: { resource: true } }
      ? { readonly handle: { readonly input: z.ZodType<{ kind: string }> } }
      : unknown;
  };
  /** Keyed by the catalog command key. */
  readonly commands: M & {
    readonly [K in keyof M]: {
      readonly writes: NoExtras<M[K]["writes"], H> & {
        readonly [N in keyof M[K]["writes"]]?: readonly Sole<M, C>[];
      };
    };
  };
  readonly sheetWrites?: SheetNative & SheetWrites<NoInfer<Id>, H, Sheet, NoInfer<Works>>;
  /** Zero or several, keyed by the route key. A subject's pane is one of the route's panes. */
  readonly routes: Routes & {
    readonly [K in keyof Routes]: NoExtras<Routes[K], ProductRoute> & {
      readonly captureSubject?: keyof Routes[K]["fields"] & string;
      readonly subject?: NoExtras<
        NonNullable<Routes[K]["subject"]>,
        NonNullable<ProductRoute["subject"]>
      > & {
        readonly pane: Routes[K]["panes"][number];
      };
    };
  };
  readonly guide?: Guide;
  readonly http?: Http;
  /** The product's local operations by catalog key; the host half owes one body each. */
  readonly local?: Local;
  readonly publishTool?: Publish;
  readonly toolName?: ToolName;
}) {
  for (const key of [writeSettingTier.key, ...Object.values(SHEET_COMMANDS)])
    if (Object.hasOwn(declaration.commands, key)) throw Error(`${key} belongs to the platform`);
  const work: RouteStateSpec<z.ZodObject<WorkShape<C>, z.core.$strict>> & {
    readonly editable: readonly EditablePath<C>[];
    readonly schemaVersion: number;
  } = {
    route: declaration.id,
    title: declaration.work?.title ?? declaration.id,
    description: declaration.says,
    settingsOwners: declaration.work?.settingsOwners,
    retired: declaration.work?.retired,
    finds: declaration.work?.finds,
    schemaVersion: declaration.work?.schemaVersion ?? 1,
    schema: workSchema(declaration.cells, declaration.work?.subjectRecord),
    editable: editable(declaration.cells),
  };
  const tool: Tool<M> & { readonly work: typeof work } = {
    name: declaration.toolName ?? declaration.id,
    says: declaration.says,
    work,
    commands: declaration.commands,
  };
  const readings = Object.values<Reading<keyof H>>(declaration.readings);
  const callPolicies: Readonly<Record<string, CallPolicy>> = Object.assign(
    {},
    ...readings.flatMap(({ load }) => load?.calls ?? []),
  );
  return {
    ...declaration,
    http: Object.assign({}, declaration.http),
    local: Object.assign({}, declaration.local),
    routes: bind<R, Routes>(declaration.readings, declaration.routes),
    guide: declaration.guide ?? noGuide,
    actions: declaration.commands,
    // With `works`, each tool carries its route's Work, and `work` and `tool` are not the product's.
    tools: toolTable<ToolName, typeof tool, Publish, C, Works>(
      declaration.id,
      declaration.toolName,
      tool,
      declaration.publishTool,
      declaration,
    ),
    settingOwners: defineSettingOwners(sheetCells(declaration)),
    basisHeaders: Object.fromEntries(
      readings.flatMap(({ load }) => Object.entries(load?.basisHeaders ?? {})),
    ),
    callPolicies,
    resourceInputs: resourceInputs<R>(declaration.readings),
    timelineReads: Object.fromEntries(
      readings.flatMap(({ handle, timelineRoute }) =>
        timelineRoute ? [[timelineRoute, handle.key]] : [],
      ),
    ),
    work,
    tool,
    reads: {
      inputs: Object.fromEntries(
        readings.map((reading) => [reading.handle.key, reading.handle.input]),
      ),
      help: readings.flatMap((reading) => reading.says ?? []).join(" "),
    },
  };
}

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
> = {
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
/** The slot's name when the product declares a key in it, so a product with none owes no table. */
type Declares<Table, Slot extends string> = [keyof Table] extends [never] ? never : Slot;
/**
 * The tables a product owes for what it declares. Kept off `HostBodies` so that type stays one plain
 * object: `implement()` intersects this in, and a declared `http` route or local operation with no
 * body fails `tsc`.
 */
export type OwedBodies<P extends ProductDeclaration, Bodies> = Required<
  Pick<Bodies, (Declares<P["http"], "http"> | Declares<P["local"], "local">) & keyof Bodies>
>;
export type FileBody<Deps> = (
  args: unknown,
  host: {
    readonly deps: Deps;
    readonly document: (target: DocumentRef) => Promise<{ readonly address: Address | null }>;
    readonly sessions: () => Promise<BridgeSessionsListData>;
  },
) => Promise<unknown>;
