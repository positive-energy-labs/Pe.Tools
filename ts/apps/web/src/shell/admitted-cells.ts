import { transitionPatches, type CellLike } from "@pe/agent-contracts";
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
  const shape = bare(ownerSchema ?? schemas[data.work.schema ?? ""]!);
  if (!(shape instanceof z.ZodObject)) throw Error("Work must be an object");
  const patchSchema = z.union([
    z.strictObject({ path: z.tuple([z.string()]), value: z.unknown() }),
    z.strictObject({ path: z.tuple([z.string(), z.string()]), value: z.unknown() }),
    z.strictObject({ path: z.tuple([z.string(), z.string(), z.string()]), value: z.unknown() }),
    z.strictObject({ path: z.tuple([z.string(), z.string()]), op: z.literal("delete") }),
  ]);
  return freezePage(
    z
      .array(patchSchema)
      .parse(value)
      .map((patch) => {
        if (patch.path.some((key) => ["__proto__", "constructor", "prototype"].includes(key)))
          throw Error("Forbidden Work path");
        let schema: z.ZodType | undefined = shape.shape[patch.path[0]];
        if (!schema) throw Error(`Undeclared Work field: ${patch.path[0]}`);
        if (patch.path.length > 1) {
          const record = bare(schema);
          if (!(record instanceof z.ZodRecord)) throw Error("Keyed Work field must be a record");
          z.parse(record.keyType, patch.path[1]);
          schema = record.valueType as z.ZodType;
          if (patch.path.length === 3) {
            const entry = bare(schema);
            if (!(entry instanceof z.ZodObject)) throw Error("Work entry must be an object");
            schema = entry.shape[patch.path[2]];
            if (!schema) throw Error(`Undeclared Work entry field: ${patch.path[2]}`);
          }
        }
        if (!("op" in patch) && !Object.hasOwn(patch, "value"))
          throw Error("Work replacement requires value");
        // WorkWrite's existing delete spelling omits value; the correlated path is unchanged.
        if (!schema) throw Error("Missing Work schema");
        return "op" in patch
          ? { path: patch.path }
          : { path: patch.path, value: schema.parse(patch.value) };
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
    transition(kind: "take" | "unsuggest" | "clear", id: string, key: unknown,
      context: unknown, work: Readonly<Record<string, unknown>>) {
      const parsed = keyFor(id, key),
        cell = data.cells[id]!;
      const segment = cell.segment === null ? work : work[cell.segment];
      // erased at route-module.ts:419 (resolvedWork.schema: z.ZodType); U3 types it as ZodType<W>
      const value = (segment as Readonly<Record<string, CellLike>> | undefined)?.[String(parsed)] ?? {};
      const transition = () => {
        const patches = transitionPatches(cell.segment === null ? [] : [cell.segment], String(parsed), value, { kind });
        // Root object fields are replaced as a whole; keyed cells may patch their rungs.
        return cell.segment === null && patches.length
          ? [{ path: [String(parsed)], value: {
              ...value,
              ...Object.fromEntries(patches.map((patch) => [patch.path.at(-1), patch.value])),
            } }]
          : patches;
      };
      const patches = kind === "take" && cell.take
        ? bodies[cell.take]!.run(context, parsed)
        : transition();
      return admittedWorkPatches(
        data,
        schemas,
        patches,
        ownerSchema,
      );
    },
  };
}
