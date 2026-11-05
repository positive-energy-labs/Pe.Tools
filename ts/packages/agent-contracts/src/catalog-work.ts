/**
 * ADR 0030 rules 2 and 9: a route-free catalog Work door. A ModelWrite earns one only from an
 * owner-authored schema whose cells are keyed by authored or native-durable keys; element ids never earn one.
 * `owner` is the Work `route` field, so a later Page attaches to the same identity and journal.
 * `workWriteCommands` (write-intent.ts) is the only plan/apply door; this file generates its entries.
 */
import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import type { WorkHandle, WorkPath } from "./command.ts";
import type { ActionReadingKey } from "./reading.ts";
import { draftCellSchema } from "./draft.ts";
import { parameterLinksDocumentSchema, stagedParameterProfile } from "./parameter-links.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { workWriteCommands } from "./write-intent.ts";

/** Plan derives the one native request from the whole Work. Step 5's DAG linker reads this same entry. */
export interface CatalogWork<S extends z.ZodType = z.ZodType> {
  owner: string;
  op: string;
  schema: S;
  derive(doc: z.infer<S>): unknown;
}

/** A Work the native op cannot apply faithfully. The plan refuses; nothing is sent. */
export class CatalogWorkRefused extends Error {}

/**
 * One data table per document Work. A column's key is its native pool slot, `text:<n>` or `number:<n>`:
 * DataTableEngine.ReconcileFields binds the n-th column of a kind to the n-th pool parameter of that
 * kind, so the slot is the column's durable identity and the heading is its value. Reorder is not
 * authored (Text slots are sent before Number slots), and a slot gap is refused, because the engine
 * would move later columns onto earlier parameters. Cells are never filled from the model: a staged row
 * must stage every cell up to its last one, and rows with no staged cell are left untouched.
 */
const slot = z.string().regex(/^(text|number):(0|[1-9]\d{0,2})$/);
const rowKey = z.string().min(1);
export const dataTablesWorkSchema = z.strictObject({
  name: draftCellSchema(z.string().min(1)).default({}),
  columns: z.record(slot, draftCellSchema(z.string().min(1), { deletable: true })).default({}),
  rows: z.record(rowKey, z.record(slot, draftCellSchema(z.string().nullable()))).default({}),
});
type DataTablesWork = z.infer<typeof dataTablesWorkSchema>;

function deriveDataTable(doc: DataTablesWork) {
  const name = doc.name.edit?.value;
  if (!name) throw new CatalogWorkRefused("Stage the table name");
  const staged = Object.entries(doc.columns)
    .filter(([, cell]) => cell.edit?.value !== undefined)
    .map(([key, cell]) => ({ key, kind: key.startsWith("text") ? "Text" : "Number", heading: cell.edit!.value! }));
  if (!staged.length) throw new CatalogWorkRefused("Stage at least one column");
  const columns = (["Text", "Number"] as const).flatMap((kind) => {
    const prefix = `${kind.toLowerCase()}:`;
    const ofKind = staged.filter((column) => column.kind === kind);
    for (let n = 0; n < ofKind.length; n++)
      if (!ofKind.some((column) => column.key === `${prefix}${n}`))
        throw new CatalogWorkRefused(
          `${prefix}${n} is not staged: the engine binds ${kind} columns by ordinal, so later ${kind} columns would move onto its parameter`,
        );
    return [...ofKind].sort((a, b) => Number(a.key.slice(prefix.length)) - Number(b.key.slice(prefix.length)));
  });
  const rows = Object.entries(doc.rows).flatMap(([key, cells]) => {
    const last = columns.findLastIndex((column) => cells[column.key]?.edit);
    if (last < 0) return [];
    const values = columns.slice(0, last + 1).map((column) => {
      const edit = cells[column.key]?.edit;
      if (!edit) throw new CatalogWorkRefused(`Row ${key}: stage ${column.key} too; a skipped cell would be cleared`);
      return edit.value;
    });
    return [{ key, values }];
  });
  return {
    table: { name, columns: columns.map(({ heading, kind }) => ({ heading, kind })), rows },
  };
}

export const catalogWorks = {
  "data-tables": {
    owner: "data-tables",
    op: "data-table.apply",
    schema: dataTablesWorkSchema,
    derive: deriveDataTable,
  } satisfies CatalogWork<typeof dataTablesWorkSchema>,
  "parameter-links": {
    owner: "parameter-links",
    op: "revit.apply.parameter-links",
    schema: parameterLinksDocumentSchema,
    derive: (doc) => {
      const profile = stagedParameterProfile(doc);
      if (!profile) throw new CatalogWorkRefused("Stage a parameter-link profile first");
      return { profile, reconcile: true };
    },
  } satisfies CatalogWork<typeof parameterLinksDocumentSchema>,
};
type Owner = keyof typeof catalogWorks;

const native = (op: string) => {
  const entry = hostOpCatalog.find((candidate) => candidate.key === op);
  if (!entry) throw Error(`catalog Work names unknown native op ${op}`);
  return entry;
};

/** The non-UI owner registrations the runtime binds; the Page-less Work a route may later attach to. */
/** The staged-cell paths each owner's Work lets a person or Pea write: one StateCell per path. */
const editable: Record<Owner, readonly WorkPath[]> = {
  "data-tables": [["name"], ["columns", "*"], ["rows", "*", "*"]],
  "parameter-links": [["definitions", "*"], ["assignments", "*"]],
};
export const catalogWorkSpecs = Object.fromEntries(
  Object.values(catalogWorks).map((work) => [
    work.owner,
    {
      route: work.owner,
      title: native(work.op).displayName,
      description: native(work.op).description,
      schema: work.schema,
      editable: editable[work.owner as Owner],
    },
  ]),
) as { [O in Owner]: RouteStateSpec<(typeof catalogWorks)[O]["schema"]> & { editable: readonly WorkPath[] } };

function catalogWorkCommand<const K extends string>(owner: Owner, key: K, dirties: readonly ActionReadingKey[]) {
  const work: CatalogWork = catalogWorks[owner];
  const definition = {
    says: native(work.op).description,
    native: [work.op],
    needs: "project-document",
    effect: "command",
    dirties,
    input: z.object({}),
  } as const;
  // The plan sends nothing native, so it names no leaf; command-axes gives a catalog Work plan Effect Read.
  return workWriteCommands(owner, key, definition, {
    derive: (doc) => work.derive(work.schema.parse(doc)),
    preview: {
      key: `${key}.plan`,
      definition: { ...definition, native: [], says: `Plan, nothing committed: ${definition.says}` },
    },
  });
}

/**
 * Generated plan/apply pairs, one per catalog Work. The host binds one generic executor over them and
 * finds each one's Work as `catalogWorks[entry.work.route]`.
 */
export const catalogWorkCommands = {
  ...catalogWorkCommand("data-tables", "data-table.apply", ["schedules"]),
  ...catalogWorkCommand("parameter-links", "parameter-links.apply", ["parameter-links"]),
};
/** A cell another route owns: edited here, journaled through the owner's handle, labelled from it. */
export interface ForeignCell {
  owner: WorkHandle;
  from: `/${string}`;
  path: WorkPath;
}

/** Where a cell's value comes from. A receipt retires `work` into `model-store` at equal precedence. */
export type CellLayer = "work" | "model-store";
