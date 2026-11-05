/**
 * ADR 0030 rules 2 and 4, step 4: one generic executor over `catalogWorks`, not one adapter per op. Each owner's
 * plan/apply pair is the `workWriteCommands` entry the contracts generate for `entry.op`; `workWriteBoundary`
 * seals the plan and rechecks it at apply. The plan only reads (Work + one native Read for the model base);
 * the apply sends the derived requests to `entry.op` through the bridge, then retires the staged cells.
 */
import { z } from "zod";
import {
  catalogWorks,
  commands,
  editableCells,
  type Command,
  type RouteStateSpec,
  type WorkPath,
} from "@pe/agent-contracts";
import { invokeBridge as invoke, type RevitBridge } from "./bridge.ts";
import { command, refused, type CommandExecutor } from "./command-executor.ts";

type Owner = keyof typeof catalogWorks;
// ponytail: host-held until CatalogWork carries them (contract edge sent to the contracts line): the cell
// universe, discovery text and the native Read that yields `derive`'s base. Delete this map then.
const owners: Record<
  Owner,
  { title: string; editable: WorkPath[]; base: { op: string; input: unknown; project(value: unknown): unknown } }
> = {
  "data-table": {
    title: "Data tables",
    editable: [
      ["tables", "*", "columns", "*"],
      ["tables", "*", "rows", "*", "*"],
    ],
    base: {
      op: "revit.detail.data-tables",
      input: {},
      // A column's durable key is its pool parameter guid; the native row values are positional to columns.
      project: (value) =>
        Object.fromEntries(
          (value as { tables: NativeTable[] }).tables.map((t) => {
            const columns = t.columns.map((c) => ({ key: c.sharedParameterGuid, heading: c.heading, kind: c.kind }));
            const rows = t.rows.map((r) => [r.key, Object.fromEntries(columns.map((c, i) => [c.key, r.values[i] ?? null]))]);
            return [t.name, { columns, rows: Object.fromEntries(rows) }];
          }),
        ),
    },
  },
  "parameter-links": {
    title: "Parameter links",
    editable: [["definitions", "*"], ["assignments", "*"]],
    base: {
      op: "revit.detail.parameter-links",
      input: { includeEvaluation: false },
      project: (value) => (value as { profile?: unknown }).profile ?? null,
    },
  },
};
interface NativeTable {
  name: string;
  columns: { heading: string; kind: "Text" | "Number"; sharedParameterGuid: string }[];
  rows: { key: string; values: (string | null)[] }[];
}

type Entry = { owner: string; op: string; schema: z.ZodType; derive(doc: never, base: never): readonly unknown[] };
type Spec = RouteStateSpec<z.ZodType> & { editable: WorkPath[] };
/** The Work a route-free owner stores: no Page, no tool; the owner is the Work `route`. */
const catalogWorkSpec = (entry: Entry): Spec => ({
  route: entry.owner,
  title: owners[entry.owner as Owner].title,
  description: `Route-free Work for ${entry.op}: stage cells, plan, then apply.`,
  schema: entry.schema,
  editable: owners[entry.owner as Owner].editable,
});
export const catalogWorkSpecs: Record<string, Spec> = Object.fromEntries(
  Object.values(catalogWorks).map((entry) => [entry.owner, catalogWorkSpec(entry)]),
);

const prepared = z.object({
  target: z.object({ session: z.string(), openId: z.string() }),
  requests: z.array(z.unknown()),
  staged: z.array(z.array(z.union([z.string(), z.number()]))),
});

/** One executor per catalog owner whose command the contracts generated; the registry wraps each in the boundary. */
export function catalogWorkExecutors(
  bridge: RevitBridge["Service"],
  definitions: Record<string, Command> = commands as unknown as Record<string, Command>,
  works: readonly Entry[] = Object.values(catalogWorks),
): Record<string, CommandExecutor> {
  return Object.fromEntries(
    works
      .filter((entry) => definitions[entry.op])
      .map((entry) => {
        const spec = catalogWorkSpec(entry);
        const base = owners[entry.owner as Owner].base;
        const executor = command(definitions[entry.op]!, prepared, {
          seal: (p) => ({ request: p.requests }),
          bind: async (ctx) => {
            if (ctx.admission.target.kind !== "document") throw refused("Exact document required");
            const target = ctx.admission.target.ref;
            const work = (ctx.admission.input as { work: import("@pe/agent-contracts").WorkHandle }).work;
            // Same handle the boundary already selected: cached, one consumed Work dependency.
            const doc = await ctx.selectWork(spec, work);
            return {
              effects: [{ kind: "document", ref: target }],
              prepare: async () => {
                const staged = editableCells(doc, spec.editable)
                  .filter(({ cell }) => cell.edit != null)
                  .map(({ path }) => path);
                if (!staged.length) throw refused("No staged cells");
                const model = base.project(await invoke(bridge, target, base.op, base.input));
                let requests: readonly unknown[];
                try {
                  requests = (entry.derive as (d: unknown, b: unknown) => readonly unknown[])(doc, model);
                } catch (error) {
                  throw refused(error instanceof Error ? error.message : String(error), "catalog.refused");
                }
                return { target, requests: [...requests], staged };
              },
            };
          },
          run: async (_ctx, execution) => {
            const { target, requests, staged } = execution.prepared;
            const results = [];
            for (const request of requests)
              results.push(
                await execution.step("native", entry.op, request, (id) =>
                  invoke(bridge, target, entry.op, request, id),
                ),
              );
            return { results, retired: staged };
          },
          retires: (result) => (result as { retired: WorkPath[] }).retired,
        });
        return [entry.op, executor];
      }),
  );
}
