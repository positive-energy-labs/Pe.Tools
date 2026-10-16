import { z } from "zod";
import { friction, sectionOf } from "./loss-physics.ts";
import type { DuctSnapshot } from "./types.ts";

const sourceSchema = z.strictObject({
  file: z.string().min(1),
  title: z.string().min(1),
  edition: z.string().min(1),
  url: z.url().refine((value) => /^https?:\/\//.test(value), "Source URL must use HTTP or HTTPS"),
  page: z.number().int().positive(),
  pdfPage: z.number().int().positive(),
});
const fieldSchema = z.enum([
  "flowCfm",
  "connector.widthIn",
  "connector.heightIn",
  "connector.diameterIn",
]);
const inputSchema = z.strictObject({
  field: fieldSchema,
  scale: z.number().positive().default(1),
  divideBy: z
    .strictObject({ field: fieldSchema, scale: z.number().positive().default(1) })
    .optional(),
});
const axisSchema = z.strictObject({
  quantity: z.string().min(1),
  unit: z.string().min(1),
  values: z.array(z.number().finite()).min(2),
  input: inputSchema.optional(),
});

/** Published orientation stays intact. `result.from` selects direct lookup or inversion.
 * Inputs use snapshot US units; scale and divideBy are explicit, never executable expressions.
 * Each grid shares one page citation; split a multi-page table into separate table ids.
 */
export const catalogTableSchema = z
  .strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    source: sourceSchema,
    rows: axisSchema,
    columns: axisSchema,
    cells: z.strictObject({
      quantity: z.string().min(1),
      unit: z.string().min(1),
      input: inputSchema.optional(),
      values: z.array(z.array(z.number().finite()).min(2)).min(2),
    }),
    result: z.strictObject({
      from: z.enum(["cells", "columns"]),
      quantity: z.enum(["static-pressure", "total-pressure", "coefficient"]),
      unit: z.enum(["in-wg", "Pa", "1"]),
      toInWg: z.number().positive(),
      velocityBasis: z.literal("connector"),
      note: z.string().min(1),
      returnAir: z.strictObject({ factor: z.number().positive(), source: sourceSchema }).optional(),
      totalPressureSource: sourceSchema.optional(),
    }),
  })
  .superRefine((t, ctx) => {
    const increasing = (xs: number[]) => xs.every((n, i) => i === 0 || n > xs[i - 1]!);
    const valid =
      increasing(t.rows.values) &&
      increasing(t.columns.values) &&
      t.cells.values.length === t.rows.values.length &&
      t.cells.values.every(
        (r) =>
          r.length === t.columns.values.length && (t.result.from !== "columns" || increasing(r)),
      ) &&
      !!t.rows.input &&
      (t.result.from === "cells" ? !!t.columns.input : !!t.cells.input) &&
      (t.result.quantity === "coefficient" ? t.result.unit === "1" : t.result.unit !== "1");
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message: "Invalid grid dimensions, monotonic axes, input mappings or pressure units",
      });
  });
export const catalogSchema = z.strictObject({
  version: z.literal(1),
  tables: z.array(catalogTableSchema),
});
export type CatalogTable = z.infer<typeof catalogTableSchema>;
export type Catalogs = Readonly<Record<string, CatalogTable>>;
export const EMPTY_CATALOGS: Catalogs = Object.freeze({});
export const catalogLinkKey = (
  family: string | null | undefined,
  type: string | null | undefined,
) => JSON.stringify([family ?? "", type ?? ""]);

type Node = DuctSnapshot["nodes"][number];
type Input = z.infer<typeof inputSchema>;
export type CatalogFinding =
  | "catalog-missing-link"
  | "catalog-missing-table"
  | "catalog-input"
  | "catalog-out-of-range";
export type CatalogLoss = {
  table?: string;
  source?: CatalogTable["source"];
  notes: string[];
} & (
  | { dp: number; staticInWg: number | null; pv: number; fpm: number }
  | { dp: null; finding: CatalogFinding; error: string }
);

/** No clamping or extrapolation, including the flow limits of an interpolated width row. */
function bracket(xs: number[], x: number): [number, number, number] | null {
  if (!Number.isFinite(x) || x < xs[0]! || x > xs.at(-1)!) return null;
  const hi = xs.findIndex((n) => n >= x);
  if (xs[hi] === x) return [hi, hi, 0];
  return [hi - 1, hi, (x - xs[hi - 1]!) / (xs[hi]! - xs[hi - 1]!)];
}
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export function catalogLoss(
  node: Node,
  cfm: number | null,
  catalogs: Catalogs,
  links: Readonly<Record<string, { table: string }>> = {},
): CatalogLoss {
  const table =
    links[catalogLinkKey(node.family, node.type)]?.table ??
    node.facts.find((f) => f.key === "Pe_Catalog")?.text?.trim();
  const t = table && Object.hasOwn(catalogs, table) ? catalogs[table] : undefined;
  const base = {
    ...(table ? { table } : {}),
    ...(t ? { source: t.source } : {}),
    notes: t
      ? [
          `${t.source.title}, ${t.source.edition}; ${t.source.file} p. ${t.source.page} (PDF ${t.source.pdfPage}); ${t.source.url}`,
          t.result.note,
        ]
      : [],
  };
  const bad = (finding: CatalogFinding, error: string): CatalogLoss => ({
    ...base,
    dp: null,
    finding,
    error,
  });
  if (!table)
    return bad(
      "catalog-missing-link",
      "No Pe_Catalog type parameter or staged family/type catalog link",
    );
  if (!t) return bad("catalog-missing-table", `Catalog table ${table} is not loaded`);
  const connectors = node.connectors.filter((c) => c.kind === "end");
  if (connectors.length !== 1 || cfm == null || !Number.isFinite(cfm) || cfm < 0)
    return bad(
      "catalog-input",
      "Catalog needs one end connector and a finite nonnegative design flow",
    );
  const c = connectors[0]!;
  const field = (key: Input["field"]) =>
    key === "flowCfm"
      ? cfm
      : c[key.slice("connector.".length) as "widthIn" | "heightIn" | "diameterIn"];
  const input = (i: Input) => {
    const value = field(i.field);
    const divisor = i.divideBy ? field(i.divideBy.field) : 1;
    return value == null || divisor == null || divisor <= 0
      ? NaN
      : (value * i.scale) / (divisor * (i.divideBy?.scale ?? 1));
  };
  const row = input(t.rows.input!);
  const rb = bracket(t.rows.values, row);
  if (!Number.isFinite(row)) return bad("catalog-input", `Missing input for ${t.rows.quantity}`);
  if (!rb)
    return bad(
      "catalog-out-of-range",
      `${t.rows.quantity} ${row} ${t.rows.unit} outside ${t.rows.values[0]}..${t.rows.values.at(-1)}`,
    );
  const [lo, hi, f] = rb;
  const values = t.columns.values.map((_, j) =>
    lerp(t.cells.values[lo]![j]!, t.cells.values[hi]![j]!, f),
  );
  const x = input((t.result.from === "columns" ? t.cells.input : t.columns.input)!);
  if (!Number.isFinite(x)) return bad("catalog-input", "Missing catalog column/flow input");
  const xs = t.result.from === "columns" ? values : t.columns.values;
  const cb = bracket(xs, x);
  if (!cb)
    return bad(
      "catalog-out-of-range",
      `Catalog input ${x} outside ${xs[0]}..${xs.at(-1)} ${t.result.from === "columns" ? t.cells.unit : t.columns.unit}`,
    );
  const ys = t.result.from === "columns" ? t.columns.values : values;
  const value = lerp(ys[cb[0]]!, ys[cb[1]]!, cb[2]);
  const section = sectionOf(c.shape, c.diameterIn, c.widthIn, c.heightIn);
  if (
    !section ||
    !(section.areaFt2 > 0) ||
    !Number.isFinite(section.areaFt2) ||
    !(section.dhIn > 0)
  )
    return bad("catalog-input", "No connector area for velocity pressure");
  const { fpm, pv } = friction(section, cfm, 0);
  const pressure = value * t.result.toInWg;
  const isReturn =
    (node.classification ?? c.classification ?? "").replaceAll(" ", "") === "ReturnAir";
  const factor =
    isReturn && t.result.quantity === "static-pressure" ? (t.result.returnAir?.factor ?? 1) : 1;
  const staticInWg = t.result.quantity === "static-pressure" ? pressure * factor : null;
  if (factor !== 1)
    base.notes.push(
      `Return static x ${factor}; ${t.result.returnAir!.source.file} p. ${t.result.returnAir!.source.page}`,
    );
  const dp =
    staticInWg == null
      ? t.result.quantity === "coefficient"
        ? value * pv
        : pressure
      : staticInWg + pv;
  if (!Number.isFinite(dp))
    return bad("catalog-input", "Catalog conversion or velocity pressure is not finite");
  return { ...base, staticInWg, pv, fpm, dp };
}
