import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts";
import { evaluate, read, type InputPort } from "@pe/host-internal/reads/evaluator";
import { host as rooms } from "@pe/rooms-host/product";
import { sheetExecutors, sheetWrites } from "../src/slots/sheet.ts";
import { bindProducts } from "../src/product-runtime.ts";

// Slice 7, the host half of the sheet slot: what sheet.plan derives from a route's Work, and the Pod's document Work door.
test("sheetWrites derives one parameter write per staged row, by UniqueId, and none for a local binding", () => {
  const code = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("pipe-1") });
  const writes = sheetWrites(
    {
      bindings: {
        chosen: {
          home: { at: "parameter", parameter: "Diameter" },
          domain: { kind: "number", unit: "Millimeters" },
          per: "subject",
        },
        maxVelocity: { home: { at: "local" }, domain: { kind: "number" }, per: "route" },
      },
    },
    { chosen: { [code]: 25, "pipe-2": 32, "pipe-3": null }, maxVelocity: 1.5 },
  );
  expect(writes.map((w) => [w.uniqueId, w.parameter, w.value, w.unit])).toEqual([
    ["pipe-1", "Diameter", 25, "Millimeters"],
    ["pipe-2", "Diameter", 32, "Millimeters"],
  ]);
  // A draft slot's cell is `{ edit: { value } }`; `{}` is a draft nobody staged.
  const draft = sheetWrites(
    {
      draft: true,
      bindings: {
        chosen: {
          home: { at: "parameter", parameter: "Diameter" },
          domain: { kind: "number" },
          per: "subject",
        },
      },
    },
    { chosen: { [code]: { edit: { value: 40, by: "pea" } }, "pipe-2": {} } },
  );
  expect(draft.map((w) => [w.uniqueId, w.value])).toEqual([["pipe-1", 40]]);
});

test("ctx.work with a document ref reads that document's Work for the owner", async () => {
  const taken: [string, unknown][] = [];
  const port: InputPort = {
    evaluation: "e",
    origin: null,
    revision: () => 0,
    take: async (name, args) => {
      taken.push([name, args]);
      if (name === "work-scope") return { binding: "host", route: "any", target: null };
      if (name === "work") return { doc: { chosen: {} }, revision: 3 };
      throw Error(`unexpected ${name}`);
    },
  };
  const probe = read("pod.probe", {
    input: z.object({}),
    output: z.unknown(),
    run: (ctx) => ctx.work("pod.hydronic.sizing", { session: "s", openId: "o" }),
  });
  const value = await evaluate(probe, {}, port);
  expect(value.data).toEqual({ doc: { chosen: {} }, revision: 3 });
  const expected = [
    ["work-scope", { route: "pod.hydronic.sizing", target: { session: "s", openId: "o" } }],
    [
      "work",
      {
        owner: "pod.hydronic.sizing",
        scope: { binding: "host", route: "pod.hydronic.sizing", target: null },
      },
    ],
  ];
  // The document's key first, then its Work under the owner; final validation takes the same leaves again.
  expect(taken.slice(0, 2)).toEqual(expected);
  for (const take of taken) expect(expected).toContainEqual(take);
});

test.each([
  [{ kind: "number", exclusiveMin: 0 }, -1],
  [{ kind: "enum", shape: { type: "string", enum: ["even", "proportional"] } }, "bogus"],
] as const)(
  "sheet.plan refuses a staged value outside its domain before a route-specific native executor binds",
  async (domain, value) => {
    const bind = vi.fn(async () => ({}));
    const losses = { "sheet.plan": { bind }, "sheet.apply": { bind } };
    const sheet = {
      draft: true,
      bindings: {
        criterion: { home: { at: "store", store: "_PE_DuctLosses" }, domain, per: "route" },
      },
    };
    const executors = sheetExecutors(
      {} as never,
      { workspace: { sheet: () => sheet } } as never,
      new Map([["duct-systems", losses as never]]),
    );
    await expect(
      executors["sheet.plan"]!.bind({
        admission: {
          input: {
            work: { key: { route: "duct-systems" } },
            doc: { criterion: { edit: { value } } },
          },
        },
      } as never),
    ).rejects.toThrow(/criterion/);
    expect(bind).not.toHaveBeenCalled();
  },
);

test("Rooms dispatches by Work route even when the product id differs", async () => {
  const bind = vi.fn(async () => ({ prepare: async () => "product" }));
  const { sheets } = bindProducts([
    {
      ...rooms,
      product: { ...rooms.product, id: "renamed-rooms" },
      executors: () => ({ "sheet.plan": { bind } as never, "sheet.apply": { bind } as never }),
    },
  ]).productExecutors({} as never, {} as never);
  const executors = sheetExecutors(
    {} as never,
    {
      workspace: {
        sheet: (route: string) => ({
          bindings: {
            field: {
              home: route.startsWith("pod.")
                ? { at: "parameter", parameter: "Diameter" }
                : { at: "store", store: "_PE_Regions" },
              domain: { kind: "number" },
              per: "subject",
            },
          },
        }),
      },
    } as never,
    sheets,
  );
  const context = (route: string) =>
    ({
      admission: {
        target: { kind: "document", ref: { session: "s", openId: "o" } },
        input: { work: { key: { route } }, doc: {} },
      },
    }) as never;
  const specialized = await executors["sheet.plan"]!.bind(context("rooms"));
  expect(await specialized.prepare!()).toEqual({ route: "rooms", value: "product" });
  await expect(executors["sheet.plan"]!.bind(context("renamed-rooms"))).rejects.toMatchObject({
    refusal: { code: "sheet.executor-unknown" },
  });
  const generic = await executors["sheet.plan"]!.bind(context("pod.other"));
  await expect(generic.prepare!()).rejects.toThrow(
    "Nothing to write: stage a parameter cell first",
  );
  expect(bind).toHaveBeenCalledTimes(1);
});

test.each(["unknown", "toString"])("an unknown sealed Work route %s refuses", (route) => {
  const executors = sheetExecutors({} as never, {});
  expect(() => executors["sheet.plan"]!.seal!({ route, value: {} })).toThrow(
    `No sheet executor for Work route ${route}`,
  );
});
