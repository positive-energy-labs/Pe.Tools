/**
 * The product declaration kernel (ruling 1 of docs/features/routes/MAP.md): one value per product at
 * `ts/products/<p>/contract/src/product.ts`, found by path. The host binds it with `implement()`
 * (`@pe/host-internal/product`) and the web with `screen()` (`@pe/web-kernel/route/screen`), and a
 * missing or extra body is a compile error. Runtime-neutral: nothing here imports a host or web package.
 */
import { z } from "zod";
import type { HostOperationKey } from "@pe/host-contracts/operation-types";
import type { Command, Tool } from "./command.ts";
import { draftCellSchema } from "./draft.ts";
import type { ReadHandle } from "./handle.ts";
import type { field, HostRead } from "./route.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { subjectRefCodeSchema } from "./subject-ref.ts";

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
export type Home<Kind extends string = string, Takes extends CellKey = CellKey> = {
  readonly kind: Kind;
  /** The identity the write door matches exactly (S11). */
  readonly key: string;
  readonly cost: HomeCost;
  /** The cell keys this home can hold. A command may land no other cell here. */
  readonly takes: readonly Takes[];
};
/** A home C# declares and writes (ruling 4): its generated handle, never a restated name. */
export type NativeHome<Prefix extends string> = { readonly key: `${Prefix}:${string}` };

/*
 * The home ladder in code (ADR 0058). Ask in order and stop at the first yes: a fact the model can
 * give again is not stored (rung 1), and a fact not applied yet is a cell no command lands (rung 2).
 * Rungs 3 to 6 are the constructors. No bound-parameter constructor exists until a product needs one.
 */
/** Rung 3: a standard of the firm or the project, in a home file by tier. */
export const homeFile = (owner: string): Home<"home-file", "route"> => ({
  kind: "home-file",
  key: `home-file:${owner}`,
  takes: ["route"],
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
export const revitEntity = (declared: NativeHome<"entity">): Home<"revit-entity", "subject"> => ({
  kind: "revit-entity",
  key: declared.key,
  takes: ["subject"],
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
export const familyParameter = (slot: string): Home<"family-parameter", "subject"> => ({
  kind: "family-parameter",
  key: `parameter:${slot}`,
  takes: ["subject"],
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
export const documentRecord = (declared: NativeHome<"owner-blob">): Home<"document-record"> => ({
  kind: "document-record",
  key: declared.key,
  takes: ["route", "name", "subject"],
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
 * holds no cell, because a fact about the model does not rest on one machine.
 */
export const machineFile = (declared: NativeHome<"machine-file">): Home<"machine-file", never> => ({
  kind: "machine-file",
  key: declared.key,
  takes: [],
  cost: {
    readsPerCommand: "One file per subject",
    placesThatCanDisagree: "One per machine",
    setupBeforeFirstUse: "None",
    writeBorrows: "Nothing in the model",
    sizeLimit: "None",
    seenInRevit: "Nothing",
  },
});

/** One staged value family. The cell list builds the Work schema; nothing annotates an existing one. */
export type Cell<S extends z.ZodType = z.ZodType, K extends CellKey = CellKey> = {
  readonly schema: S;
  readonly per: K;
};
export const cell = <S extends z.ZodType, const K extends CellKey>(
  schema: S,
  per: K,
): Cell<S, K> => ({
  schema,
  per,
});
type Homes = Readonly<Record<string, Home>>;
type Cells = Readonly<Record<string, Cell>>;
const single = <S extends z.ZodType>(schema: S) => draftCellSchema(schema).default({});
const byName = <S extends z.ZodType>(schema: S) =>
  z.record(z.string(), draftCellSchema(schema)).default({});
const bySubject = <S extends z.ZodType>(schema: S) =>
  z.record(subjectRefCodeSchema, draftCellSchema(schema)).default({});
type WorkShape<C extends Cells> = {
  -readonly [K in keyof C]: C[K]["per"] extends "route"
    ? ReturnType<typeof single<C[K]["schema"]>>
    : C[K]["per"] extends "subject"
      ? ReturnType<typeof bySubject<C[K]["schema"]>>
      : ReturnType<typeof byName<C[K]["schema"]>>;
};
/** What Pea may edit is every cell, so no second list can name a cell the schema lacks. */
export type EditablePath<C extends Cells> = {
  [K in keyof C & string]: C[K]["per"] extends "route" ? readonly [K] : readonly [K, "*"];
}[keyof C & string];
// `Object.entries` keeps no key types, so these two overloads state what the cell list builds.
function workSchema<C extends Cells>(cells: C): z.ZodObject<WorkShape<C>, z.core.$strict>;
function workSchema(cells: Cells) {
  return z.strictObject(
    Object.fromEntries(
      Object.entries(cells).map(([name, { schema, per }]) => [
        name,
        per === "route" ? single(schema) : per === "subject" ? bySubject(schema) : byName(schema),
      ]),
    ),
  );
}
function editable<C extends Cells>(cells: C): readonly EditablePath<C>[];
function editable(cells: Cells): readonly (readonly string[])[] {
  return Object.entries(cells).map(([name, { per }]) => (per === "route" ? [name] : [name, "*"]));
}

/** Load policy (S6 owns the meaning). Absent is today's behaviour. */
export type ReadingLoad = Readonly<{
  alone?: true;
  freshBy?: readonly ["document-mark"];
  slow?: string;
}>;
export type Reading<Source extends PropertyKey = string> = {
  readonly handle: Pick<ReadHandle, "key" | "input" | "data">;
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
export type ProductCommand<H extends Homes = Homes, C extends Cells = Cells> = Command & {
  readonly native: readonly HostOperationKey[];
  readonly writes: Writes<H, C>;
};
/**
 * Address fields, subject and readings. `screen()` checks the rest of the route against the kernel's
 * specification, and `panes` names every pane it must draw, no more and no fewer.
 */
export type ProductRoute = {
  readonly key: string;
  readonly fields: Readonly<Record<string, ReturnType<typeof field>>>;
  readonly subject?: { readonly field: string; readonly noun: string; readonly pane: string };
  readonly core?: HostRead;
  readonly reads?: Readonly<Record<string, HostRead>>;
  readonly panes: readonly string[];
};
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
  readonly routes: Readonly<Record<string, ProductRoute>>;
  readonly guide?: Guide;
};

/** Refuses a key the declaration does not have, even through a variable or a spread. */
export type NoExtras<Actual, Expected> = Record<Exclude<keyof Actual, keyof Expected>, never>;
const noGuide: Guide = { instructions: "", skills: [] };
/** The declaration, plus what derives from it: the Work, Pea's tool, the named reads and the guide. */
export function product<
  const Id extends string,
  const H extends Homes,
  const C extends Cells,
  const R extends Readonly<Record<string, Reading<keyof H>>>,
  const M extends Readonly<Record<string, ProductCommand<H, C>>>,
  const Routes extends Readonly<Record<string, ProductRoute>>,
>(declaration: {
  /** The product folder's name, the name of Pea's tool and the route of its Work. */
  readonly id: Id;
  readonly says: string;
  /** Only the product's own. A platform home follows from the nouns a product uses. */
  readonly homes: H;
  readonly cells: C;
  readonly readings: R;
  /** Keyed by the catalog command key. */
  readonly commands: M & {
    readonly [K in keyof M]: { readonly writes: NoExtras<M[K]["writes"], H> };
  };
  /** Zero or several. */
  readonly routes: Routes;
  readonly guide?: Guide;
}) {
  const work: RouteStateSpec<z.ZodObject<WorkShape<C>, z.core.$strict>> & {
    readonly editable: readonly EditablePath<C>[];
  } = {
    route: declaration.id,
    title: declaration.id,
    description: declaration.says,
    schema: workSchema(declaration.cells),
    editable: editable(declaration.cells),
  };
  const tool: Tool<M> & { readonly work: typeof work } = {
    name: declaration.id,
    says: declaration.says,
    work,
    commands: declaration.commands,
  };
  const readings = Object.values<Reading<keyof H>>(declaration.readings);
  return {
    ...declaration,
    guide: declaration.guide ?? noGuide,
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
export type HostBodies<P extends ProductDeclaration, Context, Executor> = {
  readonly readings: {
    readonly [K in keyof P["readings"]]: (
      ctx: Context,
      args: z.output<Handle<P, K>["input"]>,
    ) => z.output<Handle<P, K>["data"]> | Promise<z.output<Handle<P, K>["data"]>>;
  };
  readonly commands: { readonly [K in keyof P["commands"]]: Executor };
};
