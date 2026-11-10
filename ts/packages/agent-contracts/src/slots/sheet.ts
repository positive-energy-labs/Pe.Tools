import { z } from "zod";
import type { SubjectRefCode } from "../subject-ref.ts";

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

export type SheetBinding<V extends z.ZodType = z.ZodType> =
  /** A Revit parameter by name on the row's element: UniqueId key, no sub, no placement (`parameterSubject`). */
  | { kind: "parameter"; parameter: string; schema: V; per: "subject" }
  /** The model store (for ducts `_PE_DuctLosses`), any key. */
  | { kind: "store"; store: string; schema: V; per: BindingPer }
  /** Work only; feeds the Goal and never reaches Revit. */
  | { kind: "local"; schema: V; per: BindingPer };

export const parameter = <V extends z.ZodType>(parameter: string, schema: V) =>
  ({ kind: "parameter", parameter, schema, per: "subject" }) as const satisfies SheetBinding<V>;
export const store = <V extends z.ZodType>(store: string, schema: V, per: BindingPer = "subject") =>
  ({ kind: "store", store, schema, per }) as const satisfies SheetBinding<V>;
export const local = <V extends z.ZodType>(schema: V, per: BindingPer = "route") =>
  ({ kind: "local", schema, per }) as const satisfies SheetBinding<V>;

/** The declaration: bindings by cell name. Rows are the route subject; the kernel supplies them. */
export interface SheetSlot<B extends Readonly<Record<string, SheetBinding>> = Readonly<Record<string, SheetBinding>>> {
  readonly bindings: B;
}

/** The cell's address: a binding name, and the row for a per-subject binding. */
export interface CellAddress {
  readonly binding: string;
  readonly subject?: SubjectRefCode;
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
export const sheetSlotDataSchema = z.strictObject({
  bindings: z.record(
    z.string(),
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("parameter"), parameter: z.string().min(1), per: z.literal("subject") }),
      z.strictObject({ kind: z.literal("store"), store: z.string().min(1), per: z.enum(["subject", "route"]) }),
      z.strictObject({ kind: z.literal("local"), per: z.enum(["subject", "route"]) }),
    ]),
  ),
});
export type SheetSlotData = z.output<typeof sheetSlotDataSchema>;
