/**
 * The product declaration kernel (ruling 1 of docs/features/routes/MAP.md): one value per product at
 * `ts/products/<p>/contract/src/product.ts`. Until S9 the generator finds it by the contract package's
 * `./product` export; from S9 it finds it by path, and the export stops being a switch. The host binds it with `implement()`
 * (`@pe/host-internal/product`) and the web with `screen()` (`@pe/web-kernel/route/screen`), and a
 * missing or extra body is a compile error. Runtime-neutral: nothing here imports a host or web package.
 */
import { z } from "zod";
import { nativeHomes } from "@pe/host-contracts/generated";
import type { HostOperationKey } from "@pe/host-contracts/operation-types";
import type { Command, Tool } from "./command.ts";
import { draftCellSchema } from "./draft.ts";
import type { ReadHandle } from "./handle.ts";
import { hostRead, read, type field, type HostRead } from "./route.ts";
import type { RouteGraphWire } from "./route-kernel-data.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { schemaOf, type Domain, type DomainValue, type Placement } from "./slots/sheet.ts";
import { subjectRefCodeSchema } from "./subject-ref.ts";
import { workWriteCommands, writeIntentSchema } from "./write-intent.ts";
import { SETTING_TIERS, type SettingTier } from "./tiered-setting.ts";
import type { Publication } from "./value.ts";

/** Unexported, so only this module makes a home, a native home handle or a cell. */
const made: unique symbol = Symbol("declared");

/** How a cell is keyed: one for the whole Work, one per free name, or one per subject. */
export type CellKey = "route" | "name" | "subject";
/** The six questions every home kind answers (ADR 0058 decision 4). The homes table renders them. */
export type HomeCost = {
  readonly readsPerCommand: string;
  readonly placesThatCanDisagree: string;
  readonly setupBeforeFirstUse: string;
  readonly writeBorrows: string;
  readonly sizeLimit: string;
  readonly seenInRevit: string;
};
/** Where a stored fact rests. Only the constructors below make one, so a new kind is a kernel change. */
export type Home<Takes extends CellKey = CellKey> = {
  readonly [made]: "home";
  readonly kind: string;
  /** The identity the write door matches exactly (S11). */
  readonly key: string;
  readonly cost: HomeCost;
  /** The cell keys this home can hold. A command may land no other cell here. */
  readonly takes: readonly Takes[];
  /** How a sheet places a cell that lands here (ADR 0032: placement is derived, never per field). */
  readonly place: (cell: string) => Placement;
};
/**
 * A home C# declares and writes (ruling 4): its generated handle, never a restated name. Only
 * `nativeHome()` makes one, from the table typegen emits from C#'s `NativeHomes`.
 */
export type NativeHome<Prefix extends string> = {
  readonly [made]: "native";
  readonly key: `${Prefix}:${string}`;
};
type NativeHomeName = keyof typeof nativeHomes;
type PrefixOf<K> = K extends `${infer P}:${string}` ? P : never;
/** The handle of a home C# declared, by its C# name, as `handle()` reads the command table. */
export function nativeHome<N extends NativeHomeName>(
  name: N,
): NativeHome<PrefixOf<(typeof nativeHomes)[N]>>;
export function nativeHome(name: NativeHomeName): NativeHome<string> {
  return { [made]: "native", key: nativeHomes[name] };
}

/*
 * The home ladder in code (ADR 0058). Ask in order and stop at the first yes: a fact the model can
 * give again is not stored (rung 1), and a fact not applied yet is a cell no command lands (rung 2).
 * Rungs 3 to 6 are the constructors. No bound-parameter constructor exists until a product needs one.
 */
/** Rung 3: a standard of the firm or the project, in a home file by tier. */
export const homeFile = (
  owner: string,
  tiers: readonly SettingTier[] = SETTING_TIERS,
): Home<"route"> => ({
  [made]: "home",
  kind: "home-file",
  key: `home-file:${owner}`,
  takes: ["route"],
  place: (cell) => ({ at: "setting", owner, path: cell.split("."), tiers }),
  cost: {
    readsPerCommand: "One file per tier",
    placesThatCanDisagree: "One per tier: default, firm and document",
    setupBeforeFirstUse: "A firm home, for the firm tier only",
    writeBorrows: "Project Information, for the document tier only",
    sizeLimit: "256 KiB for the document tier",
    seenInRevit: "Nothing",
  },
});
/** Rung 4: an entity on the element, only where Revit's own calculation must read the fact. */
export const revitEntity = (declared: NativeHome<"entity">): Home<"subject"> => ({
  [made]: "home",
  kind: "revit-entity",
  key: declared.key,
  takes: ["subject"],
  place: () => ({ at: "store", store: declared.key }),
  cost: {
    readsPerCommand: "One per element",
    placesThatCanDisagree: "One per element",
    setupBeforeFirstUse: "A schema, which can never gain a field",
    writeBorrows: "The element",
    sizeLimit: "One versioned JSON text per element",
    seenInRevit: "Nothing; Revit's calculation reads it",
  },
});
/** Rung 5: a named parameter the family already has. A setting holds its name. */
export const familyParameter = (slot: string): Home<"subject"> => ({
  [made]: "home",
  kind: "family-parameter",
  key: `parameter:${slot}`,
  takes: ["subject"],
  place: () => ({ at: "parameter", parameter: slot }),
  cost: {
    readsPerCommand: "One per element",
    placesThatCanDisagree: "One per element; a person can edit it in Revit",
    setupBeforeFirstUse: "None; the family already has it",
    writeBorrows: "The element",
    sizeLimit: "One value",
    seenInRevit: "The value, in Properties, tags and schedules",
  },
});
/** Rung 6: Pe's own fact about an element, in the product's one document record keyed by `UniqueId`. */
export const documentRecord = (declared: NativeHome<"owner-blob">): Home => ({
  [made]: "home",
  kind: "document-record",
  key: declared.key,
  takes: ["route", "name", "subject"],
  place: () => ({ at: "store", store: declared.key }),
  cost: {
    readsPerCommand: "One, the whole record",
    placesThatCanDisagree: "One",
    setupBeforeFirstUse: "None; the first write binds one hidden parameter",
    writeBorrows: "Project Information, so one person writes a product's facts between syncs",
    sizeLimit: "256 KiB per record, provisional until measure M1",
    seenInRevit: "Nothing: no tag, filter, schedule or Properties row",
  },
});
/**
 * Beside the ladder: evidence a native operation keeps on this machine, such as a solver trace. It
 * holds no cell, because a fact about the model does not rest on one machine. It is on no rung of
 * ADR 0058; owner confirmation pending in the product-declaration run.
 */
export const machineFile = (declared: NativeHome<"machine-file">): Home<never> => ({
  [made]: "home",
  kind: "machine-file",
  key: declared.key,
  takes: [],
  place: () => ({ at: "local" }),
  cost: {
    readsPerCommand: "One file per subject",
    placesThatCanDisagree: "One per machine",
    setupBeforeFirstUse: "None",
    writeBorrows: "Nothing in the model",
    sizeLimit: "None",
    seenInRevit: "Nothing",
  },
});

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
};
export const cell = <const D extends Domain, const K extends CellKey>(
  domain: D,
  per: K,
  draw: { readonly label?: string; readonly default?: DomainValue<D> } = {},
): Cell<D, K> => ({ ...draw, [made]: "cell", domain, per });
type Homes = Readonly<Record<string, Home>>;
type Cells = Readonly<Record<string, Cell>>;
const single = <S extends z.ZodType>(schema: S) => draftCellSchema(schema).default({});
const byName = <S extends z.ZodType>(schema: S) =>
  z.record(z.string(), draftCellSchema(schema)).default({});
const bySubject = <S extends z.ZodType>(schema: S) =>
  z.record(subjectRefCodeSchema, draftCellSchema(schema)).default({});
type Schema<C extends Cell> = z.ZodType<DomainValue<C["domain"]>>;
type WorkShape<C extends Cells> = {
  /** A staged command's authored input, by command key (`workWriteCommands`). */
  writeIntent: z.ZodDefault<typeof writeIntentSchema>;
} & {
  -readonly [K in keyof C]: C[K]["per"] extends "route"
    ? ReturnType<typeof single<Schema<C[K]>>>
    : C[K]["per"] extends "subject"
      ? ReturnType<typeof bySubject<Schema<C[K]>>>
      : ReturnType<typeof byName<Schema<C[K]>>>;
};
/** What Pea may edit is every cell, so no second list can name a cell the schema lacks. */
export type EditablePath<C extends Cells> =
  | readonly ["writeIntent", "*"]
  | {
      [K in keyof C & string]: C[K]["per"] extends "route" ? readonly [K] : readonly [K, "*"];
    }[keyof C & string];
// `Object.entries` keeps no key types, so these two overloads state what the cell list builds.
function workSchema<C extends Cells>(cells: C): z.ZodObject<WorkShape<C>, z.core.$strict>;
function workSchema(cells: Cells) {
  return z.strictObject({
    writeIntent: writeIntentSchema.default({}),
    ...Object.fromEntries(
      Object.entries(cells).map(([name, { domain, per }]) => {
        const schema = schemaOf(domain);
        return [
          name,
          per === "route" ? single(schema) : per === "subject" ? bySubject(schema) : byName(schema),
        ];
      }),
    ),
  });
}
function editable<C extends Cells>(cells: C): readonly EditablePath<C>[];
function editable(cells: Cells): readonly (readonly string[])[] {
  return [
    ["writeIntent", "*"],
    ...Object.entries(cells).map(([name, { per }]) => (per === "route" ? [name] : [name, "*"])),
  ];
}

/** Load policy (S6 owns the meaning). Absent is today's behaviour. */
export type ReadingLoad = Readonly<{
  alone?: true;
  freshBy?: readonly ["document-mark"];
  slow?: string;
}>;
export type Reading<Source extends PropertyKey = string> = {
  readonly handle: ReadHandle;
  /** The product's homes this reading reads, by name. */
  readonly sources: readonly Source[];
  readonly load?: ReadingLoad;
  /** One sentence for Pea's read discovery. */
  readonly says?: string;
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
export type ProductCommand<
  H extends Homes = Homes,
  C extends Cells = Cells,
  W extends string = string,
> = Omit<Command, "work" | "derivation"> & {
  readonly native: readonly HostOperationKey[];
  readonly writes: Writes<H, C>;
  /**
   * The Work this command's input is staged in. A staged command is sealed: `product()` builds its
   * apply entry and its `.preview` plan (`workWriteCommands`), which the command registry demands
   * of every ModelWrite. Without `derive` the input is the Work's `writeIntent[key]`.
   */
  readonly staged?: W;
  readonly derive?: (work: unknown) => unknown;
};
type Sealed<K extends string, D extends Command> = ReturnType<typeof workWriteCommands<K, D>>;
type Intersect<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;
/** The command table a declaration builds: each staged command with its plan beside it. */
type BuiltCommands<M> = Intersect<
  {
    [K in keyof M & string]: M[K] extends { staged: string }
      ? Sealed<K, Omit<M[K], "staged" | "derive"> & Command>
      : { [P in K]: M[K] };
  }[keyof M & string]
>;
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
  };
  readonly core?: Named<R>;
  readonly reads?: Readonly<Record<string, Named<R>>>;
  readonly panes: readonly string[];
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
  readonly [K in keyof Route]: K extends "core"
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
    return read(hostRead(reading.handle), args);
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
  readonly commands: Readonly<
    Record<string, Command & Pick<ProductCommand, "native" | "writes">>
  >;
  readonly routes: Readonly<Record<string, { readonly key: string }>>;
  readonly guide?: Guide;
};
type Stored = Pick<ProductDeclaration, "homes" | "cells" | "commands">;
/** The home each cell lands in, by name, from every command's `writes`. A cell not here stays in Work. */
export const landings = ({
  commands,
}: Pick<Stored, "commands">): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.values(commands).flatMap((command) =>
      Object.entries(command.writes).flatMap(([home, cells]) =>
        (cells ?? []).map((name) => [name, home]),
      ),
    ),
  );
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
type WorkSpec<C extends Cells> = RouteStateSpec<z.ZodObject<WorkShape<C>, z.core.$strict>> & {
  readonly editable: readonly EditablePath<C>[];
};
/**
 * ponytail: a Work that predates cells (Takeoffs: edits, baselines, verdicts) is declared whole.
 * Ceiling: no cell of it can land in a home or reach a sheet. Restate it as cells when its commands
 * move onto the cell grammar.
 */
type WholeWork = RouteStateSpec<z.ZodObject> & {
  readonly editable: readonly (readonly string[])[];
};
/** The declaration, plus what derives from it: each Work, Pea's tools, the named reads and the guide. */
export function product<
  const Id extends string,
  const H extends Homes,
  const C extends Cells,
  const Works extends Readonly<Record<string, readonly (keyof C & string)[] | WholeWork>>,
  const R extends Readonly<Record<string, Reading<keyof H>>>,
  const M extends Readonly<Record<string, ProductCommand<H, C, keyof Works & string>>>,
  const Routes extends Readonly<Record<string, ProductRoute<keyof R & string>>>,
>(declaration: {
  /** The product folder's name, and the tool of every command staged in no Work. */
  readonly id: Id;
  readonly says: string;
  /** Only the product's own. A platform home follows from the nouns a product uses. */
  readonly homes: H;
  readonly cells: C;
  /** Each Work by its route namespace, with the cells it holds. Work stays route-scoped. */
  readonly works: Works;
  readonly readings: R;
  /** Keyed by the catalog command key. */
  readonly commands: M & {
    readonly [K in keyof M]: {
      readonly writes: NoExtras<M[K]["writes"], H> & {
        readonly [N in keyof M[K]["writes"]]?: readonly Sole<M, C>[];
      };
    };
  };
  /** Zero or several, keyed by the route key. A subject's pane is one of the route's panes. */
  readonly routes: Routes & {
    readonly [K in keyof Routes]: {
      readonly subject?: { readonly pane: Routes[K]["panes"][number] };
    };
  };
  readonly guide?: Guide;
}) {
  const works = Object.fromEntries(
    Object.entries(declaration.works).map(([route, names]) => {
      if (!Array.isArray(names)) return [route, names];
      const cells = Object.fromEntries(
        names.map((name: string) => [name, declaration.cells[name]!]),
      );
      return [
        route,
        {
          route,
          title: route,
          description: declaration.says,
          schema: workSchema(cells),
          editable: editable(cells),
        },
      ];
    }),
  ) as unknown as {
    readonly [K in keyof Works]: Works[K] extends readonly (keyof C)[]
      ? WorkSpec<Pick<C, Works[K][number]>>
      : Works[K];
  };
  const built = Object.entries<ProductCommand>(declaration.commands).map(
    ([key, { staged, derive, ...command }]) => ({
      staged,
      entries: staged
        ? workWriteCommands(staged, key, command, derive ? { derive } : {})
        : { [key]: command },
    }),
  );
  const commands = Object.assign({}, ...built.map((row) => row.entries)) as BuiltCommands<M>;
  // One tool per Work, and one named for the product when a command is staged in none.
  const names = [...new Set([...Object.keys(declaration.works), declaration.id])];
  const tools: Readonly<Record<string, Tool>> = Object.fromEntries(
    names.flatMap((name) => {
      const own = built.filter((row) => (row.staged ?? declaration.id) === name);
      const work = (works as Readonly<Record<string, Tool["work"]>>)[name];
      if (!work && !own.length) return [];
      return [
        [
          name,
          {
            name,
            says: declaration.says,
            ...(work && { work }),
            commands: Object.assign({}, ...own.map((row) => row.entries)),
          },
        ],
      ];
    }),
  );
  const readings = Object.values<Reading<keyof H>>(declaration.readings);
  return {
    ...declaration,
    commands,
    routes: bind<R, Routes>(declaration.readings, declaration.routes),
    guide: declaration.guide ?? noGuide,
    works,
    tools,
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
export type HostBodies<P extends ProductDeclaration, Context, Executor> = {
  readonly readings: {
    readonly [K in keyof P["readings"]]: (
      ctx: Context,
      args: z.output<Handle<P, K>["input"]>,
    ) => z.output<Handle<P, K>["data"]> | Promise<z.output<Handle<P, K>["data"]>>;
  };
  /** A plan is its write's body in the preview phase, so it takes none of its own. */
  readonly commands: {
    readonly [K in keyof P["commands"] as K extends `${string}.preview` ? never : K]: Executor;
  };
};
