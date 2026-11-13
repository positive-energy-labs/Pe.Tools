import { expect, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";
import type { OpRequestOf } from "@pe/host-contracts/operation-types";
import { contract, handle, native, type CommandHandle, type InputOf } from "./handle.ts";
import { commands } from "./semantic-actions.ts";
import { minted } from "./command-handle.ts";

test("handle() mints a command from the generated table, with its plan when it is a sealed write", () => {
  const apply = handle("sheet.apply");
  expect(apply).toMatchObject({ key: "sheet.apply", effect: "ModelWrite", via: "command" });
  expect(apply.plan.key).toBe(commands["sheet.apply"].writeBoundary.previewKey);
  expect(["Read", "TransactRead"]).toContain(apply.plan.effect);
  expect(handle("sheet.apply")).toBe(apply);
  expect(apply[minted]).toBe(true);
  expect(Object.isFrozen(apply)).toBe(true);
  expectTypeOf(apply.effect).toEqualTypeOf<"ModelWrite">();
  expectTypeOf<InputOf<typeof apply>>().toEqualTypeOf<z.input<(typeof commands)["sheet.apply"]["input"]>>();
  // A verb declaration demands `present` exactly when the handle carries a plan.
  expectTypeOf(apply).toExtend<{ plan: object }>();
  expectTypeOf(handle("sheet.plan")).not.toExtend<{ plan: object }>();
  expect("plan" in handle("sheet.plan")).toBe(false);
});

test("handle() mints a pe-api route key and a raw native key, and the door reads the transport from `via`", () => {
  const bind = handle("page.bind");
  expect(bind).toMatchObject({ key: "page.bind", effect: "SessionWrite", via: { route: "page.bind" } });
  expectTypeOf(bind).toExtend<CommandHandle<"page.bind">>();
  const raw = handle("ducts.apply");
  expect(raw).toMatchObject({ key: "ducts.apply", effect: "ModelWrite", via: "command" });
  expectTypeOf<InputOf<typeof raw>>().toEqualTypeOf<OpRequestOf<"ducts.apply">>();
  const local = handle("host.shell.open");
  expectTypeOf<InputOf<typeof local>>().toEqualTypeOf<OpRequestOf<"host.shell.open">>();
});

test("handle() refuses a key in neither table", () => {
  // @ts-expect-error not a command and not a route
  expect(() => handle("nope.never")).toThrow("No command or route: nope.never");
});

test("native() mints a catalog Read with its catalog axes and refuses a write", () => {
  const options = native("revit.catalog.field-options");
  expect(options.key).toBe("revit.catalog.field-options");
  expect(options.axes.effect).toBe("Read");
  expect(options.output.safeParse({ key: "k", generation: 0, version: 1, state: "current", value: null }).success).toBe(true);
  expect(native("revit.catalog.field-options")).toBe(options);
  // @ts-expect-error a ModelWrite leaf is not a catalog Read
  expect(() => native("ducts.apply")).toThrow("Not a catalog Read: ducts.apply");
});

test("contract() joins its axes from what it uses: effect max, cost max, touches union", () => {
  const data = z.object({ rows: z.array(z.string()) });
  const alone = contract("probe.alone", { input: z.null(), data, uses: [] });
  expect(alone.axes).toEqual({ subject: "Document", touches: ["Metadata"], effect: "Read", cost: "Cheap", cardinality: "One" });
  expect(alone.keyedBy).toEqual({});
  const rehearsal = native("ducts.heal.preview");
  const read = native("revit.catalog.field-options");
  const joined = contract("probe.joined", {
    input: z.null(),
    data,
    uses: [alone, "revit.catalog.field-options", "ducts.heal.preview"],
    keyedBy: { rows: { kind: "UniqueId" } },
    demand: "explicit",
  });
  expect(joined.axes.effect).toBe("TransactRead");
  expect(joined.axes.rollsBack).toBe(true);
  const order = ["Cheap", "Bounded", "Expensive", "Mutation"];
  expect(order.indexOf(joined.axes.cost)).toBe(Math.max(...[rehearsal, read].map((use) => order.indexOf(use.axes.cost))));
  expect(new Set(joined.axes.touches)).toEqual(new Set(["Metadata", ...rehearsal.axes.touches, ...read.axes.touches]));
  expect(joined).toMatchObject({ keyedBy: { rows: { kind: "UniqueId" } }, demand: "explicit" });
  const value = { data: { rows: ["a"] }, evaluation: "e", inputs: "i", trace: [],
    coverage: { requested: [], unknown: [], covered: [], refused: [] }, origin: null, freshness: "current" };
  expect(joined.output.parse({ key: "k", generation: 0, version: 1, state: "current", value }).value?.data.rows).toEqual(["a"]);
  expect(joined.output.safeParse({ key: "k", generation: 0, version: 1, state: "current", value: { ...value, data: { rows: [1] } } }).success).toBe(false);
});
