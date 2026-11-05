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
  /**
   * The native Read the plan takes, and apply retakes after consent, for the stored state `derive` lays the
   * Work over. Required: an owner whose op omits keys must read them to resend them (K3).
   */
  base: { op: string; input(doc: z.infer<S>): unknown; project(response: unknown, doc: z.infer<S>): B };
  /**
   * Per top-level collection of the base: `replace` means the op drops a key it is not sent, so `derive` must resend
   * every stored key unchanged; `patch` means an omitted key is untouched, so a key sent must carry its stored value.
   * The class falsifier (keyed-write-coverage.test.ts) enforces this per stored key; an undeclared collection fails.
   */
  mutation: Record<string, "replace" | "patch">;
  derive(doc: z.infer<S>, base: B): { request: unknown; touched: readonly CatalogTouch[] };
}

/** A Work the native op cannot apply faithfully. The plan refuses; nothing is sent. */
export class CatalogWorkRefused extends Error {}

/**
 * One data table per document Work, keyed like the model: a column by its native pool slot, `text:<n>` or
 * `number:<n>` (DataTableEngine binds a kind's n-th column to slot n), a cell by row key then slot. The op
 * replaces columns whole and rewrites a sent row positionally, so the plan lays staged cells over the stored
 * table: every stored column is resent at its slot, a touched row resends its unstaged cells' stored values,
 * and untouched rows are not sent (rows upsert). A delete that leaves a slot gap would remap later columns
 * onto other parameters, so it refuses.
 */
const slot = z.string().regex(/^(text|number):(0|[1-9]\d{0,2})$/);
const rowKey = z.string().min(1);
export const dataTablesWorkSchema = z.strictObject({
  name: draftCellSchema(z.string().min(1)).default({}),
  columns: z.record(slot, draftCellSchema(z.string().min(1), { deletable: true })).default({}),
  rows: z.record(rowKey, z.record(slot, draftCellSchema(z.string().nullable()))).default({}),
});
type DataTablesWork = z.infer<typeof dataTablesWorkSchema>;
/** The stored table by slot: headings, and each row's cells. Null: the document has no table of that name. */
export type DataTableBase = {
  columns: Record<string, string>;
  rows: Record<string, Record<string, string | null>>;
} | null;

const tableName = (doc: DataTablesWork) => {
  const name = doc.name.edit?.value;
  if (!name) throw new CatalogWorkRefused("Stage the table name");
  return name;
};
const slotOrder = (key: string) => [key.startsWith("text") ? 0 : 1, Number(key.split(":")[1])] as const;

function deriveDataTable(doc: DataTablesWork, base: DataTableBase) {
  const name = tableName(doc);
  const touched: CatalogTouch[] = [];
  const by = (edit: { by?: Author } | null | undefined) => edit?.by ?? "unknown";
  if (doc.name.edit) touched.push({ path: ["name"], before: base ? name : null, after: name, by: by(doc.name.edit as StagedEdit) });
  const columns: Record<string, string> = { ...base?.columns };
  for (const [key, cell] of Object.entries(doc.columns)) {
    const edit = cell.edit as StagedEdit;
    if (!edit) continue;
    const before = base?.columns[key] ?? null;
    if (edit.delete && before == null) throw new CatalogWorkRefused(`Column ${key} is not stored; nothing to delete`);
    if (edit.delete) delete columns[key];
    else columns[key] = edit.value as string;
    touched.push({ path: ["columns", key], before, after: edit.delete ? null : edit.value, by: by(edit) });
  }
  const order = Object.keys(columns).sort((a, b) => slotOrder(a)[0] - slotOrder(b)[0] || slotOrder(a)[1] - slotOrder(b)[1]);
  for (const kind of ["text", "number"])
    order.filter((k) => k.startsWith(kind)).forEach((k, n) => {
      if (k !== `${kind}:${n}`)
        throw new CatalogWorkRefused(`${kind}:${n} would be empty: the engine binds ${kind} columns by ordinal, so ${k} would move onto another parameter`);
    });
  if (!order.length) throw new CatalogWorkRefused("A data table needs at least one column");
  const rows = Object.entries(doc.rows).flatMap(([key, cells]) => {
    const staged = Object.entries(cells).filter(([, cell]) => cell.edit);
    if (!staged.length) return [];
    for (const [slotKey, cell] of staged) {
      if (!(slotKey in columns)) throw new CatalogWorkRefused(`Row ${key}: ${slotKey} is not a column of ${name}`);
      touched.push({ path: ["rows", key, slotKey], before: base?.rows[key]?.[slotKey] ?? null, after: (cell.edit as StagedEdit)!.value ?? null, by: by(cell.edit as StagedEdit) });
    }
    const values = order.map((k) => {
      const edit = cells[k]?.edit as StagedEdit;
      return edit ? ((edit.value as string | null) ?? null) : (base?.rows[key]?.[k] ?? null);
    });
    return [{ key, values }];
  });
  if (!touched.some((t) => t.path[0] !== "name") && base) throw new CatalogWorkRefused(`Stage a column or cell of ${name} first`);
  const kindOf = (k: string) => (k.startsWith("text") ? "Text" : "Number");
  return {
    request: { table: { name, columns: order.map((k) => ({ heading: columns[k]!, kind: kindOf(k) })), rows } },
    touched,
  };
}

/** The native detail read, by slot (`DataTableColumnHandle.slot`), for the one table the Work names. */
function projectDataTable(response: unknown, doc: DataTablesWork): DataTableBase {
  type Native = { tables: { name: string; columns: { heading: string; kind: string; slot: number }[]; rows: { key: string; values: (string | null)[] }[] }[] };
  const table = (response as Native).tables.find((t) => t.name === tableName(doc));
  if (!table) return null;
  const keys = table.columns.map((c) => `${c.kind.toLowerCase()}:${c.slot}`);
  return {
    columns: Object.fromEntries(table.columns.map((c, i) => [keys[i], c.heading])),
    rows: Object.fromEntries(table.rows.map((r) => [r.key, Object.fromEntries(keys.map((k, i) => [k, r.values[i] ?? null]))])),
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
    base: { op: "revit.detail.data-tables", input: (doc) => ({ names: [tableName(doc)] }), project: projectDataTable },
    mutation: { name: "replace", columns: "replace", rows: "patch" },
    derive: deriveDataTable,
  } satisfies CatalogWork<typeof dataTablesWorkSchema, DataTableBase>,
  "parameter-links": {
    owner: "parameter-links",
    op: "revit.apply.parameter-links",
    schema: parameterLinksDocumentSchema,
    base: {
      op: "revit.detail.parameter-links",
      input: () => ({ includeEvaluation: false }),
      project: (response) => parameterLinkProfileSchema.nullish().parse((response as { profile?: unknown }).profile) ?? null,
    },
    mutation: { definitions: "replace", assignments: "replace" },
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
  const work: Pick<CatalogWork, "op" | "schema"> = catalogWorks[owner];
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
