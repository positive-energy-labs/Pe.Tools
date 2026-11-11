import { z } from "zod";

/*
 * The sheet slot (ADR 0035 rules 1 and 3; ADR 0030 rules 4, 6 and 8). A route fills it with data:
 * bindings keyed by cell name. The kernel draws one StateCell per binding per row, stages through
 * the one Work write path, and reaches Revit through one plan/apply pair (`SHEET_COMMANDS`).
 * Owner: slice 7. Scaffold: types and the closed kinds only.
 */

/** Three closed binding kinds. Only the kernel adds one; the firm file is a layer, a Pod member a home. */
export const BINDING_KINDS = ["parameter", "store", "local"] as const;
export type BindingKind = (typeof BINDING_KINDS)[number];

/** Whether a binding has one cell per subject row or one cell for the route. */
export type BindingPer = "subject" | "route";

/** One option a binding offers a row: what picking it stages (`value`, else `key`), or a clear. */
export interface SheetChoice {
  readonly key: string;
  readonly label: string;
  readonly value?: unknown;
  readonly description?: string;
  /** Listed, greyed and unpickable, with this reason in place of the description. */
  readonly disabled?: string;
  readonly clear?: true;
}

/** A layer under Work for one row: what the model, the store, the firm file or a default holds, and from where. */
export interface CellLayer {
  readonly value: unknown;
  readonly source?: Exclude<CellSource, "work">;
  /** Which file, store key or version the value came from (the firm line: version and file). */
  readonly ref?: string;
  readonly freshness?: StateCell["freshness"];
  /** This row's unit when the read knows it (a resolved criterion's `units`); else the binding's. */
  readonly unit?: string;
  /** The row cannot be staged now, and why (a unit with no flow parameter): the cell draws locked. */
  readonly refusal?: string;
  /** What the read says about this row beside its value (a model/walk flow conflict). */
  readonly note?: string;
}

/**
 * How the kernel reads and draws a binding beyond Work. The data fields reach the projection; the
 * functions read the route's core read (`R`) and stay web side, like `schema`.
 */
export interface BindingDraw<R = any> {
  readonly label?: string;
  /** The display unit (a parameter binding's is also the Revit unit it writes in). */
  readonly unit?: string;
  /** The last layer: drawn, never staged, when no Work, model, store or firm value stands. */
  readonly default?: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly digits?: number;
  /** The value is an object; the cell edits this one numeric key (`{ inWg }`). */
  readonly field?: string;
  /** The binding's own rows, apart from the route subject (equipment units, criteria, slot names). */
  readonly rows?: (read: R) => readonly string[];
  readonly rowLabel?: (read: R, row: string) => string;
  readonly model?: (read: R, row: string | undefined) => CellLayer | null | undefined;
  readonly choices?: (read: R, row: string | undefined) => readonly SheetChoice[];
}

export type SheetBinding<V extends z.ZodType = z.ZodType> = BindingDraw &
  (
    /** A Revit parameter by name on the row's element: UniqueId key, no sub, no placement (`parameterSubject`). `unit` names a measurable value's unit (a Revit UnitTypeId name or symbol). */
    | { kind: "parameter"; parameter: string; schema: V; per: "subject" }
    /** The model store (for ducts `_PE_DuctLosses`), any key. */
    | { kind: "store"; store: string; schema: V; per: BindingPer }
    /** Work only; feeds the Goal and never reaches Revit. */
    | { kind: "local"; schema: V; per: BindingPer }
  );

export const parameter = <V extends z.ZodType>(parameter: string, schema: V, unit?: string, draw?: BindingDraw) =>
  ({ ...draw, kind: "parameter", parameter, schema, per: "subject", ...(unit ? { unit } : {}) }) as const satisfies SheetBinding<V>;
export const store = <V extends z.ZodType>(store: string, schema: V, per: BindingPer = "subject", draw?: BindingDraw) =>
  ({ ...draw, kind: "store", store, schema, per }) as const satisfies SheetBinding<V>;
export const local = <V extends z.ZodType>(schema: V, per: BindingPer = "route", draw?: BindingDraw) =>
  ({ ...draw, kind: "local", schema, per }) as const satisfies SheetBinding<V>;

/** The declaration: bindings by cell name. Rows are the route subject; the kernel supplies them. */
export interface SheetSlot<B extends Readonly<Record<string, SheetBinding>> = Readonly<Record<string, SheetBinding>>> {
  readonly bindings: B;
  /** Work holds an ADR 0030 draft cell (`{ edit: { value, by, at } }`) at every address; absent, a raw value. */
  readonly draft?: true;
  /**
   * Read-only provenance this sheet's answer depends on: one line, and a link that opens the other
   * route on it when that provenance is another route's Work (absent for a layer the host refuses,
   * such as the firm layer with no shared root). A sheet reads across routes; it stages only its own Work.
   */
  readonly from?: (read: any, search: Readonly<Record<string, unknown>>) => { readonly says: string; readonly href?: string } | null;
  /** What the sheet says instead of its cells when its read has nothing for it, with the exit (house law 9). */
  readonly empty?: (read: any) => string | null;
}

/** The cell's address: a binding name, and the row for a per-subject binding (a SubjectRef code, or the binding's own row key). */
export interface CellAddress {
  readonly binding: string;
  readonly row?: string;
}

/** Where the drawn value came from (ADR 0026 layers: Work → model store → firm → default), or the model itself. */
export type CellSource = "work" | "model-store" | "firm" | "default" | "model";

/** Every value Pea can touch (ADR 0030 rule 8): current, model (struck), pending author, drift, freshness, source. */
export interface StateCell<V = unknown> extends CellAddress {
  readonly kind: BindingKind;
  readonly value: V | null;
  /** What Revit or the store holds now; shown struck when it disagrees with `value`. */
  readonly model: V | null;
  readonly pending: { readonly by: "person" | "pea"; readonly value: V; readonly at: string } | null;
  readonly drift: boolean;
  readonly freshness: "fresh" | "stale" | "unverified" | "never";
  readonly source: CellSource;
}

/** One model-side value the kernel reads for a binding's row before drawing. */
export interface ModelValue<V = unknown> extends CellAddress {
  readonly value: V | null;
  readonly freshness: StateCell["freshness"];
}

/**
 * The one plan/apply pair every sheet reaches Revit through (ADR 0030 rule 4): `plan` is a Read
 * with an empty footprint that returns the seal; `apply` is the ModelWrite that takes it. The
 * linker rule holds: a ModelWrite binds a plan whose effect is Read or TransactRead.
 */
export const SHEET_COMMANDS = { plan: "sheet.plan", apply: "sheet.apply" } as const;

/** The data projection a Pod decodes at the boundary (ADR 0035 rule 4). */
const drawData = {
  label: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  digits: z.number().int().nonnegative().optional(),
  field: z.string().min(1).optional(),
};
export const sheetSlotDataSchema = z.strictObject({
  draft: z.literal(true).optional(),
  bindings: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("parameter"), parameter: z.string().min(1), per: z.literal("subject"), ...drawData }),
      z.strictObject({ kind: z.literal("store"), store: z.string().min(1), per: z.enum(["subject", "route"]), ...drawData }),
      z.strictObject({ kind: z.literal("local"), per: z.enum(["subject", "route"]), ...drawData }),
    ]),
  ),
});
export type SheetSlotData = z.output<typeof sheetSlotDataSchema>;
/** The declaration's data projection: every binding without its schema. */
export const sheetSlotData = (slot: SheetSlot): SheetSlotData => ({
  // `from` is web side: a function of the read, like a binding's `model`.
  ...(slot.draft ? { draft: true as const } : {}),
  bindings: Object.fromEntries(Object.entries(slot.bindings).map(([name, binding]) => [name,
    Object.fromEntries(Object.entries(binding).filter(([key, value]) => key !== "schema" && typeof value !== "function"))])),
}) as SheetSlotData;
/** A binding the plan derives a Revit write from (`local` feeds only the Goal). */
export const writesRevit = (data: SheetSlotData) => Object.values(data.bindings).some((b) => b.kind !== "local");
