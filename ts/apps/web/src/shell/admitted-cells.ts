import { bare } from "../../../../packages/agent-contracts/src/route-field";
import { z } from "zod";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { SchemaTable } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { freezePage } from "./page-port";

export function admittedWorkPatches(
  data: RouteGraphJson,
  schemas: SchemaTable,
  value: unknown,
  ownerSchema?: z.ZodType,
) {
  if (!data.work) throw Error("Work unavailable");
  const shape = bare(ownerSchema ?? schemas[data.work.schema ?? ""]!) as z.ZodObject;
  return freezePage(
    z
      .array(z.strictObject({ path: z.tuple([z.string()]), value: z.unknown() }))
      .parse(value)
      .map((patch) => {
        const schema = shape.shape[patch.path[0]];
        if (!schema) throw Error(`Undeclared Work field: ${patch.path[0]}`);
        return { path: patch.path, value: schema.parse(patch.value) };
      }),
  );
}

/** Cell display is cached at publication; focus/take remain explicit actions on the shared owners. */
export function createAdmittedCells(
  data: RouteGraphJson,
  schemas: SchemaTable,
  bodies: Readonly<Record<string, { run: (...args: any[]) => unknown }>>,
  ownerSchema?: z.ZodType,
) {
  let rows: Readonly<
    Record<
      string,
      readonly {
        key: unknown;
        group: readonly string[];
        labels: readonly string[];
        text: string | null;
      }[]
    >
  > = {};
  const keyFor = (id: string, key: unknown) => {
    const cell = data.cells[id];
    if (!cell) throw Error(`Unknown cell: ${id}`);
    return freezePage(cell.key ? schemas[cell.key]!.parse(key) : z.string().parse(key));
  };
  return {
    update(work: Readonly<Record<string, unknown>> | null) {
      const next: typeof rows = Object.fromEntries(
        Object.entries(data.cells).map(([id, cell]) => {
          const segment = cell.segment === null ? work : work?.[cell.segment];
          return [
            id,
            Object.entries((segment ?? {}) as Record<string, unknown>).map(([key, value]) => {
              const parsed = keyFor(id, key);
              const group = z.array(z.string()).parse(bodies[cell.groupOf]!.run(parsed));
              const labels = cell.label
                ? group.map((part) => z.string().parse(bodies[cell.label!]!.run(part)))
                : group;
              const text = cell.show
                ? z
                    .string()
                    .parse(bodies[cell.show]!.run(freezePage(schemas[cell.value]!.parse(value))))
                : null;
              return { key: parsed, group, labels, text };
            }),
          ];
        }),
      );
      rows = freezePage(next);
    },
    rows: () => rows,
    focus(id: string, key: unknown) {
      const parsed = keyFor(id, key),
        cell = data.cells[id]!;
      if (!cell.focus) throw Error("Cell has no focus action");
      return bodies[cell.focus]!.run(parsed);
    },
    take(id: string, key: unknown, context: unknown) {
      const parsed = keyFor(id, key),
        cell = data.cells[id]!;
      if (!cell.take) throw Error("Cell has no take action");
      return admittedWorkPatches(
        data,
        schemas,
        bodies[cell.take]!.run(context, parsed),
        ownerSchema,
      );
    },
  };
}
