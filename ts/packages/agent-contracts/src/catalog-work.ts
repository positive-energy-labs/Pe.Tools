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
import type { Author } from "./draft.ts";
import {
  parameterLinkProfileSchema,
  parameterLinksDocumentSchema,
  type ParameterLinkProfile,
  type ParameterLinksDocument,
} from "./parameter-links.ts";
import type { RouteStateSpec } from "./route-state.ts";
import type { CatalogAxes } from "./catalog.ts";
import { workWriteCommands } from "./write-intent.ts";

/** One staged id the plan changes: the model's value it read (null: absent), the result, and its author. */
export interface CatalogTouch {
  path: WorkPath;
  before: unknown;
  after: unknown;
  by: Author;
}
/**
 * Plan derives the one native request from the whole Work laid over `base`, what the model holds now
 * (read by the owner's host reader at plan and again after consent). Step 5's DAG linker reads this entry.
 */
export interface CatalogWork<S extends z.ZodType = z.ZodType, B = unknown> {
  owner: string;
  op: string;
  schema: S;
  derive(doc: z.infer<S>, base: B): { request: unknown; touched: readonly CatalogTouch[] };
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
    for (const [slot, cell] of Object.entries(cells))
      if (cell.edit && !columns.some((column) => column.key === slot))
        throw new CatalogWorkRefused(`Row ${key}: ${slot} is not a staged column`);
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

type StagedEdit = { value?: unknown; delete?: true; by?: Author } | null | undefined;
/**
 * ADR 0030 rule 8: staged ids lay over the stored profile by id. A set replaces its id, a delete removes only
 * its id, and every unstaged stored id is kept, because the native reconcile replaces the profile whole.
 */
export function mergeParameterProfile(doc: ParameterLinksDocument, stored: ParameterLinkProfile | null) {
  const touched: CatalogTouch[] = [];
  const merged = (["definitions", "assignments"] as const).map((kind) => {
    const byId = new Map<string, { id: string }>((stored?.[kind] ?? []).map((entry) => [entry.id, entry]));
    for (const [id, cell] of Object.entries(doc[kind])) {
      const edit = cell.edit as StagedEdit;
      if (!edit) continue;
      const before = byId.get(id) ?? null;
      if (edit.delete && !before) throw new CatalogWorkRefused(`${kind} ${id} is not stored; nothing to delete`);
      const after = edit.delete ? null : { ...(edit.value as object), id };
      if (after) byId.set(id, after);
      else byId.delete(id);
      touched.push({ path: [kind, id], before, after, by: edit.by ?? "unknown" });
    }
    return [kind, [...byId.values()]] as const;
  });
  if (!touched.length) throw new CatalogWorkRefused("Stage a parameter-link definition or assignment first");
  const profile = parameterLinkProfileSchema.safeParse({ formatVersion: stored?.formatVersion ?? 1, ...Object.fromEntries(merged) });
  if (!profile.success) throw new CatalogWorkRefused(`The merged profile is invalid: ${profile.error.issues[0]?.message}`);
  return { request: { profile: profile.data, reconcile: true }, touched };
}

export const catalogWorks = {
  "data-tables": {
    owner: "data-tables",
    op: "data-table.apply",
    schema: dataTablesWorkSchema,
    // Data tables read no base: cells are never filled from the model (above).
    derive: (doc) => ({ request: deriveDataTable(doc), touched: [] }),
  } satisfies CatalogWork<typeof dataTablesWorkSchema, undefined>,
  "parameter-links": {
    owner: "parameter-links",
    op: "revit.apply.parameter-links",
    schema: parameterLinksDocumentSchema,
    derive: mergeParameterProfile,
  } satisfies CatalogWork<typeof parameterLinksDocumentSchema, ParameterLinkProfile | null>,
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
  const work: CatalogWork<z.ZodType, never> = catalogWorks[owner];
  const leaf = native(work.op);
  // The apply carries its native ModelWrite's axes; the plan declares its own Read (ADR 0030 rule 4).
  const axes: CatalogAxes = {
    subject: leaf.subject as CatalogAxes["subject"],
    touches: leaf.touches.split(", ") as CatalogAxes["touches"],
    effect: leaf.effect as CatalogAxes["effect"],
    cost: "Mutation",
    cardinality: leaf.cardinality as CatalogAxes["cardinality"],
  };
  const definition = {
    says: leaf.description,
    native: [work.op],
    needs: "project-document",
    effect: "command",
    dirties,
    input: z.object({}),
    axes,
  } as const;
  // The plan only derives from Work and sends nothing native, so it names no leaf and declares Read.
  // The boundary only parses the Work; the host executor reads the owner's base and derives (both phases).
  return workWriteCommands(owner, key, definition, {
    derive: (doc) => ({ doc: work.schema.parse(doc) }),
    preview: {
      key: `${key}.plan`,
      definition: {
        ...definition,
        native: [],
        axes: { ...axes, effect: "Read" },
        says: `Plan, nothing committed: ${definition.says}`,
      },
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
