/**
 * ADR 0030 rules 2 and 9: a route-free catalog Work door. A ModelWrite earns one only from an
 * owner-authored schema whose cells are keyed by authored or model-durable keys; element ids never earn one.
 * `owner` is the Work `route` field, so a later Page attaches to the same identity and journal.
 * `workWriteCommands(owner, op, ...)` (write-intent.ts) is the plan/apply door; this file adds no second one.
 */
import { z } from "zod";
import type { WorkHandle, WorkPath } from "./command.ts";
import { draftCellSchema } from "./draft.ts";
import {
  parameterLinksDocumentSchema,
  stagedParameterProfile,
  type ParameterLinkProfile,
} from "./parameter-links.ts";

/** A plan derives native requests from Work laid over `base`, the model's current authored state, read at plan. */
export interface CatalogWork<S extends z.ZodType = z.ZodType, B = unknown> {
  owner: string;
  op: string;
  schema: S;
  derive(doc: z.infer<S>, base: B): readonly unknown[];
}

/** A Work the native op cannot apply faithfully. The plan refuses; nothing is sent. */
export class CatalogWorkRefused extends Error {}

const key = z.string().min(1);
const column = z.strictObject({ heading: z.string().min(1), kind: z.enum(["Text", "Number"]) });
type Column = z.infer<typeof column>;
/**
 * One data table. A column's key is durable: an existing column's pool shared-parameter guid, or any
 * authored key for a new one. Order is not authored: the native engine binds a column to its pool
 * parameter by ordinal within kind (DataTableEngine.ReconcileFields), so a same-kind reorder or a
 * delete before the last same-kind column would move values onto another parameter. Both are refused
 * until the engine binds `DataTableColumnSpec` by shared guid.
 */
const dataTable = z.strictObject({
  columns: z.record(key, draftCellSchema(column, { deletable: true })).default({}),
  rows: z.record(key, z.record(key, draftCellSchema(z.string().nullable()))).default({}),
});
export const dataTableWorkSchema = z.strictObject({ tables: z.record(key, dataTable).default({}) });
export interface DataTableBase {
  columns: readonly (Column & { key: string })[];
  rows: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
}

function deriveTable(name: string, work: z.infer<typeof dataTable>, base: DataTableBase) {
  const edit = (k: string) => work.columns[k]?.edit;
  const kept = base.columns.filter(({ key: k }) => !edit(k)?.delete);
  for (const [i, col] of base.columns.entries()) {
    const next = edit(col.key)?.value;
    if (next && next.kind !== col.kind)
      throw new CatalogWorkRefused(`${name}: column "${col.heading}" cannot change kind`);
    const later = base.columns
      .slice(i + 1)
      .some((other) => other.kind === col.kind && !edit(other.key)?.delete);
    if (edit(col.key)?.delete && later)
      throw new CatalogWorkRefused(
        `${name}: deleting "${col.heading}" would move later ${col.kind} columns onto other parameters; delete the last ${col.kind} column first`,
      );
  }
  const added = Object.entries(work.columns)
    .filter(([k, cell]) => cell.edit?.value && !base.columns.some((col) => col.key === k))
    .map(([k, cell]) => ({ ...cell.edit!.value!, key: k }));
  const columns = [...kept.map((col) => ({ ...col, ...edit(col.key)?.value })), ...added];
  // A new column may reuse a freed pool parameter that still holds values, so every row is sent then.
  const rowKeys = new Set([
    ...Object.keys(work.rows),
    ...(added.length || kept.length < base.columns.length ? Object.keys(base.rows) : []),
  ]);
  const rows = [...rowKeys].map((row) => ({
    key: row,
    values: columns.map(({ key: k }) => {
      const cell = work.rows[row]?.[k]?.edit;
      return cell ? cell.value : (base.rows[row]?.[k] ?? null);
    }),
  }));
  return {
    table: { name, columns: columns.map(({ heading, kind }) => ({ heading, kind })), rows },
  };
}

const staged = (table: z.infer<typeof dataTable>) =>
  Object.values(table.columns).some((cell) => cell.edit) ||
  Object.values(table.rows).some((row) => Object.values(row).some((cell) => cell.edit));

const empty: DataTableBase = { columns: [], rows: {} };
export const catalogWorks = {
  "data-table": {
    owner: "data-table",
    op: "data-table.apply",
    schema: dataTableWorkSchema,
    derive: (doc, bases) =>
      Object.entries(doc.tables)
        .filter(([, table]) => staged(table))
        .map(([name, table]) => deriveTable(name, table, bases[name] ?? empty)),
  } satisfies CatalogWork<typeof dataTableWorkSchema, Readonly<Record<string, DataTableBase>>>,
  "parameter-links": {
    owner: "parameter-links",
    op: "revit.apply.parameter-links",
    schema: parameterLinksDocumentSchema,
    derive: (doc, stored) => {
      const profile = stagedParameterProfile(doc, stored);
      return profile ? [{ profile, reconcile: true }] : [];
    },
  } satisfies CatalogWork<typeof parameterLinksDocumentSchema, ParameterLinkProfile | null>,
};

/** A cell another route owns: edited here, journaled through the owner's handle, labelled from it. */
export interface ForeignCell {
  owner: WorkHandle;
  from: `/${string}`;
  path: WorkPath;
}

/** Where a cell's value comes from. A receipt retires `work` into `model-store` at equal precedence. */
export type CellLayer = "work" | "model-store";
