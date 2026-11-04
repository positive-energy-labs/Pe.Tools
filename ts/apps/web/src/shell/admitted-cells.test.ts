import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  acceptedWorkPatches,
  rejectedWorkPatches,
  workPatchSchema,
} from "../../../../packages/agent-contracts/src/route-kernel-work-patches.fixtures";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { createAdmittedCells, admittedWorkPatches } from "./admitted-cells";
test("cell display validates shapes and caches bodies; takes validate Work patches", () => {
  const data = {
    work: { schema: "work" },
    cells: {
      edits: {
        segment: "edits",
        key: "text",
        value: "text",
        groupOf: "group",
        show: "show",
        label: "label",
        focus: "focus",
        take: "take",
        deps: { page: [], work: [], readings: [] },
      },
    },
  } as unknown as RouteGraphJson;
  const schemas = { text: z.string(), work: z.object({ edits: z.record(z.string(), z.string()) }) };
  const group = vi.fn((key) => [key]);
  const bodies = {
    group: { run: group },
    show: { run: String },
    label: { run: (s: string) => s.toUpperCase() },
    focus: { run: (key: string) => ({ query: key }) },
    take: {
      run: (ctx: unknown, key: string) => {
        expect(ctx).toEqual({ page: {}, work: {}, readings: {} });
        return [{ path: ["edits"], value: { [key]: "taken" } }];
      },
    },
  };
  const cells = createAdmittedCells(data, schemas, bodies);
  cells.update({ edits: { a: "one" } });
  expect(cells.rows().edits).toEqual([{ key: "a", group: ["a"], labels: ["A"], text: "one" }]);
  cells.rows();
  expect(group).toHaveBeenCalledOnce();
  expect(cells.focus("edits", "a")).toEqual({ query: "a" });
  expect(cells.transition("take", "edits", "a", { page: {}, work: {}, readings: {} }, {})).toEqual([
    { path: ["edits"], value: { a: "taken" } },
  ]);
  expect(() => admittedWorkPatches(data, schemas, [{ path: ["secret"], value: 1 }])).toThrow(
    "Undeclared Work field",
  );
  expect(() => admittedWorkPatches(data, schemas, [{ path: ["edits"], value: 1 }])).toThrow();
  for (const key of ["group", "show", "label"])
    expect(() =>
      createAdmittedCells(data, schemas, { ...bodies, [key]: { run: () => 12 } }).update({
        edits: { a: "one" },
      }),
    ).toThrow();
});

test("shared Work cell patches use the owner's schema without a presenter schema", () => {
  const data = { work: { route: "owner" } } as unknown as RouteGraphJson;
  const owner = z.object({ amount: z.number() });
  expect(admittedWorkPatches(data, {}, [{ path: ["amount"], value: 2 }], owner)).toEqual([
    { path: ["amount"], value: 2 },
  ]);
  expect(() =>
    admittedWorkPatches(data, {}, [{ path: ["amount"], value: "bad" }], owner),
  ).toThrow();
});

test("schema-derived typed Work paths agree with runtime admission", () => {
  const data = { work: { schema: "work" } } as unknown as RouteGraphJson;
  const schemas = { work: workPatchSchema };
  for (const patch of acceptedWorkPatches) {
    const admitted = admittedWorkPatches(data, schemas, [patch]);
    expect(admitted).toEqual([
      "op" in patch ? { path: patch.path } : { path: patch.path, value: patch.value },
    ]);
  }
  for (const patch of rejectedWorkPatches)
    expect(() => admittedWorkPatches(data, schemas, [patch]), JSON.stringify(patch)).toThrow();
});


test("root cell families enumerate only their declared keys", () => {
  const cells = createAdmittedCells({
    work: {route: "fans", schema: "work", version: 1, migrations: []},
    cells: {
      designFriction: {segment: null, value: "cell", groupOf: "group", deps: {page: [], work: [], readings: []}},
      named: {segment: null, key: "keys", value: "cell", groupOf: "group", deps: {page: [], work: [], readings: []}},
    },
  }, {cell: z.unknown(), keys: z.enum(["a", "b"])}, {group: {run: () => []}});
  cells.update({designFriction: {value: 1}, a: {value: 2}, b: {value: 3}, unrelated: {}});
  expect(cells.rows().designFriction?.map(row => row.key)).toEqual(["designFriction"]);
  expect(cells.rows().named?.map(row => row.key)).toEqual(["a", "b"]);
});
