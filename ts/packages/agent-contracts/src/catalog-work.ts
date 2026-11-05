/**
 * ADR 0030 rules 2 and 9, step 4 scaffold: a route-free catalog Work door. A ModelWrite earns one only
 * from an owner-authored schema whose cells are keyed by authored keys; element ids never earn one.
 * `owner` is the Work `route` field, so a later Page attaches to the same identity and journal.
 * `workWriteCommands(owner, op, ...)` (write-intent.ts) is the plan/apply door; this file adds no second one.
 */
import { z } from "zod";
import type { WorkHandle, WorkPath } from "./command.ts";
import { parameterLinkProfileSchema } from "./parameter-links.ts";

export interface CatalogWork<S extends z.ZodType = z.ZodType> {
  owner: string;
  op: string;
  schema: S;
  /** Plan derives the native request from the whole Work. Step 5's DAG linker reads this same entry. */
  derive(doc: z.infer<S>): unknown;
}

const column = z.strictObject({ heading: z.string().min(1), kind: z.enum(["Text", "Number"]) });
// ponytail: native binds a column to its pool parameter by ordinal within kind, so `columns` order is authored
// and reordering two same-kind columns remaps model values (the hurting case). Cells key by heading.
const table = z.strictObject({
  columns: z.array(column),
  rows: z.record(z.string().min(1), z.record(z.string(), z.string().nullable())),
});
const definition = parameterLinkProfileSchema.shape.definitions.element;
const assignment = parameterLinkProfileSchema.shape.assignments.unwrap().element;

export const catalogWorks = {
  "data-table": {
    owner: "data-table",
    op: "data-table.apply",
    schema: z.strictObject({ tables: z.record(z.string().min(1), table) }),
    derive: () => owed("data-table derive"),
  },
  "parameter-links": {
    owner: "parameter-links",
    op: "revit.apply.parameter-links",
    schema: z.strictObject({
      definitions: z.record(z.string().min(1), definition.omit({ id: true })),
      assignments: z.record(z.string().min(1), assignment.omit({ id: true })),
    }),
    derive: () => owed("parameter-links derive"),
  },
} satisfies Record<string, CatalogWork>;

/** A cell another route owns: edited here, journaled through the owner's handle, labelled from it. */
export interface ForeignCell {
  owner: WorkHandle;
  from: `/${string}`;
  path: WorkPath;
}

/** Where a cell's value comes from. A receipt retires `work` into `model-store` at equal precedence. */
export type CellLayer = "work" | "model-store";

function owed(what: string): never {
  throw new Error(`step4 scaffold: ${what} is owed`);
}
