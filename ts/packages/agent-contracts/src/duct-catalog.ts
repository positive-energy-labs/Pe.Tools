import { z } from "zod";
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
      /** Return/exhaust static multiplier and the page that states it. */
      returnAir: z
        .strictObject({ factor: z.number().positive(), page: z.number().int().positive() })
        .optional(),
      /** The page that says total = static + velocity pressure. */
      totalPage: z.number().int().positive().optional(),
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

export type CatalogInput = z.infer<typeof inputSchema>;
export const ductCatalogReadingSchema = z.object({
  tables: z.record(z.string(), catalogTableSchema),
  findings: z.array(z.string()),
});
