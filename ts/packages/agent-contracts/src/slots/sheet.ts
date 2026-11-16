import { z } from "zod";
import { SETTING_TIERS, type SettingTier } from "../tiered-setting.ts";
import type { native } from "../handle.ts";
import type { OpRequestOf } from "@pe/host-contracts/operation-types";
type OptionsRequest = OpRequestOf<"revit.catalog.field-options">;
export type OptionsDomain = { kind: "options"; handle: ReturnType<typeof native<"revit.catalog.field-options">>; input: OptionsRequest | ((read: unknown) => OptionsRequest); persist: "value" | "label"; mode: "constraint" | "suggestion" };

export type NumberDomain = { kind: "number"; unit?: string; min?: number; exclusiveMin?: number; max?: number; digits?: number };
export type EnumChoice = { value: unknown; label: string; description?: string; disabled?: string };
export type Domain =
  | NumberDomain
  | { kind: "enum"; shape: z.ZodType; choices: readonly EnumChoice[] | ((read: any, row?: string) => readonly EnumChoice[]) }
  | OptionsDomain
  /** `text` names optional free-text keys that ride beside the fields (where a number came from); they draw no editor. */
  | { kind: "object"; fields: Readonly<Record<string, Domain>>; text?: readonly string[] };
export type Home = z.output<typeof homeSchema>;

export type DomainValue<D extends Domain> = D extends NumberDomain ? number
  : D extends { kind: "enum"; shape: z.ZodType<infer V> } ? V
  : D extends { kind: "options" } ? string
  : D extends { kind: "object"; fields: infer F extends Record<string, Domain> } ? { [K in keyof F]: DomainValue<F[K]> }
  : never;
/** Decode is independent of the choices a current read happens to offer. */
const textKeys = (text: readonly string[] = []) => Object.fromEntries(text.map(key => [key, z.string().optional()]));
export function schemaOf<const D extends Domain>(domain: D): z.ZodType<DomainValue<D>>;
export function schemaOf(domain: Domain): z.ZodType {
  switch (domain.kind) {
    case "number": {
      let schema = z.number();
      if (domain.min !== undefined) schema = schema.min(domain.min);
      if (domain.exclusiveMin !== undefined) schema = schema.gt(domain.exclusiveMin);
      if (domain.max !== undefined) schema = schema.max(domain.max);
      return schema;
    }
    case "enum": return domain.shape;
    case "options": return z.string().min(1);
    case "object": return z.strictObject({ ...textKeys(domain.text), ...Object.fromEntries(Object.entries(domain.fields).map(([key, field]) => [key, schemaOf(field)])) });
  }
}

/*
 * The sheet slot (ADR 0035 rules 1 and 3; ADR 0030 rules 4, 6 and 8). A route fills it with data:
 * bindings keyed by cell name. The kernel draws one StateCell per binding per row, stages through
 * the one Work write path, and reaches Revit through one plan/apply pair (`SHEET_COMMANDS`).
 * Value domains derive decoding; homes declare where an edit belongs.
 */

export type BindingPer = "subject" | "route";

/** A layer under Work for one row: what the model, the store, a home tier or a default holds, and from where. */
export interface CellLayer {
  readonly value: unknown;
  /** A host-resolved layer can contain Work from its evaluation, even after the live cell moved. */
  readonly source?: CellSource;
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
 * functions read the route's core read (`R`) and stay web side.
 */
export interface BindingDraw<R = any> {
  readonly label?: string;
  readonly default?: unknown;
  /** The binding's own rows, apart from the route subject (equipment units, criteria, slot names). */
  readonly rows?: (read: R) => readonly string[];
  readonly rowLabel?: (read: R, row: string) => string;
  readonly model?: (read: R, row: string | undefined) => CellLayer | null | undefined;
}

export type SheetBinding = BindingDraw & { readonly domain: Domain } & (
  | { readonly home: Extract<Home, { at: "parameter" }>; readonly per: "subject" }
  | { readonly home: Extract<Home, { at: "setting" }>; readonly per: "route" }
  | { readonly home: Extract<Home, { at: "store" | "local" }>; readonly per: BindingPer }
);
export const parameter = (parameter: string, domain: Domain, draw?: BindingDraw): SheetBinding =>
  ({ ...draw, domain, home: { at: "parameter", parameter }, per: "subject" });
export const store = (store: string, domain: Domain, per: BindingPer = "subject", draw?: BindingDraw): SheetBinding =>
  ({ ...draw, domain, home: { at: "store", store }, per });
export const local = (domain: Domain, per: BindingPer = "route", draw?: BindingDraw): SheetBinding =>
  ({ ...draw, domain, home: { at: "local" }, per });
export const setting = (owner: string, path: readonly string[], domain: Domain, tiers: readonly SettingTier[], draw?: BindingDraw): SheetBinding =>
  ({ ...draw, domain, home: { at: "setting", owner, path, tiers }, per: "route" });

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
  /**
   * What the sheet's Work stages that no cell shows (an edit at an address the bindings do not draw):
   * one line above the cells, so the route's save never writes more than a person can read here.
   */
  readonly note?: (read: any) => string | null;
}

/** The cell's address: a binding name, and the row for a per-subject binding (a SubjectRef code, or the binding's own row key). */
export interface CellAddress {
  readonly binding: string;
  readonly row?: string;
}

/**
 * Where the drawn value came from (ADR 0026 layers: Work → model store → project → firm → default), or
 * the model itself. `user`, `project` and `firm` name the home that served it; a home that was not
 * found is never a source.
 */
export type CellSource = "work" | "model-store" | SettingTier | "default" | "model";

/** Every value Pea can touch (ADR 0030 rule 8): current, model (struck), pending author, drift, freshness, source. */
export interface StateCell<V = unknown> extends CellAddress {
  readonly home: Home;
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

/** Enum schemas travel as JSON Schema; callbacks and read bodies stay local. */
export type DomainData = NumberDomain
  | { kind: "enum"; shape: Record<string, unknown> }
  | { kind: "options"; handle: "revit.catalog.field-options"; input?: Record<string, unknown>; persist: "value" | "label"; mode: "constraint" | "suggestion" }
  | { kind: "object"; fields: Record<string, DomainData>; text?: string[] };
export const domainDataSchema: z.ZodType<DomainData> = z.lazy(() => z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("number"), unit: z.string().optional(), min: z.number().optional(), exclusiveMin: z.number().optional(), max: z.number().optional(), digits: z.number().int().nonnegative().optional() }),
  z.strictObject({ kind: z.literal("enum"), shape: z.record(z.string(), z.unknown()) }),
  z.strictObject({ kind: z.literal("options"), handle: z.literal("revit.catalog.field-options"), input: z.record(z.string(), z.unknown()).optional(), persist: z.enum(["value", "label"]), mode: z.enum(["constraint", "suggestion"]) }),
  z.strictObject({ kind: z.literal("object"), fields: z.record(z.string(), domainDataSchema), text: z.array(z.string().min(1)).optional() }),
]));
export const homeSchema = z.discriminatedUnion("at", [
  z.strictObject({ at: z.literal("parameter"), parameter: z.string().min(1) }),
  z.strictObject({ at: z.literal("store"), store: z.string().min(1) }),
  z.strictObject({ at: z.literal("local") }),
  z.strictObject({ at: z.literal("setting"), owner: z.string().min(1), path: z.array(z.string().min(1)).min(1).readonly(), tiers: z.array(z.enum(SETTING_TIERS)).min(1).readonly() }),
]);
export const sheetSlotDataSchema = z.strictObject({
  draft: z.literal(true).optional(),
  bindings: z.record(z.string(), z.strictObject({
    home: homeSchema, domain: domainDataSchema, per: z.enum(["subject", "route"]),
    label: z.string().optional(), default: z.unknown().optional(),
  }).refine(b => b.home.at === "parameter" ? b.per === "subject" : b.home.at === "setting" ? b.per === "route" : true, "This home does not admit that row cardinality")),
});
export type SheetSlotData = z.output<typeof sheetSlotDataSchema>;
const domainData = (domain: Domain): DomainData => {
  switch (domain.kind) {
    case "enum": return { kind: domain.kind, shape: JSON.parse(JSON.stringify(z.toJSONSchema(domain.shape), (key, value) => key === "~standard" ? undefined : value)) };
    case "object": return { kind: domain.kind, fields: Object.fromEntries(Object.entries(domain.fields).map(([key, value]) => [key, domainData(value)])), ...(domain.text ? { text: [...domain.text] } : {}) };
    case "options": return { kind: domain.kind, handle: domain.handle.key, ...(typeof domain.input === "function" ? {} : { input: { ...domain.input } }), persist: domain.persist, mode: domain.mode };
    default: return domain;
  }
};
export function schemaOfData(domain: z.output<typeof domainDataSchema>): z.ZodType {
  if (domain.kind === "enum") return z.fromJSONSchema(domain.shape);
  if (domain.kind === "object") return z.strictObject({ ...textKeys(domain.text), ...Object.fromEntries(Object.entries(domain.fields).map(([key, value]) => [key, schemaOfData(value)])) });
  if (domain.kind === "options") return z.string().min(1);
  return schemaOf(domain);
}
export const sheetSlotData = (slot: SheetSlot): SheetSlotData => sheetSlotDataSchema.parse({
  ...(slot.draft ? { draft: true } : {}),
  bindings: Object.fromEntries(Object.entries(slot.bindings).map(([name, b]) => [name, {
    home: b.home, domain: domainData(b.domain), per: b.per,
    ...(b.label ? { label: b.label } : {}), ...(b.default !== undefined ? { default: b.default } : {}),
  }])),
});
export const writesRevit = (data: SheetSlotData) => Object.values(data.bindings).some(b => b.home.at === "parameter" || b.home.at === "store");
