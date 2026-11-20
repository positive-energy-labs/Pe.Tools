import { expect, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";
import { ductLossData } from "@pe/ducts-contract/duct-loss-read";
import { contract, native, type ReadHandle } from "@pe/agent-contracts/handle";
import { result as ductLoss } from "../../web/src/duct-loss/contract.ts";
import {
  body,
  bodyOf,
  evaluate,
  leaf,
  nativeRead,
  type InputPort,
  type ReadContext,
} from "@pe/host-internal/reads/evaluator";
import { Publications } from "../src/reads/publications.ts";
import { readRegistry, registeredReads, graphRoute } from "../src/reads/routes.ts";
import { hostRead } from "@pe/agent-contracts/route";
import * as fanContracts from "@pe/fans-contract/contract";
import * as systemContracts from "@pe/duct-systems-contract/contract";
import { GUIDE_CALC_READS } from "@pe/fans-contract/calc-read";
import { peRoutes } from "@pe/mcps/product-catalog";
import { workspace as roomsWorkspace } from "../../web/src/rooms/contract.ts";
import { BridgeError } from "@pe/host-internal/bridge";

const contracts = [
  ...Object.entries(
    import.meta.glob<Record<string, ReadHandle>>("../../web/src/*/contract.ts", { eager: true }),
  ),
  ["fans", fanContracts],
  ["duct-systems", systemContracts],
] as const;
const shape = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: "any" });
test("every guide calc read resolves through pe-api and the registered host read", () => {
  const apiInput = z.fromJSONSchema(peRoutes["reads.value"].catalog.discovery!.input!);
  for (const read of Object.values(GUIDE_CALC_READS)) {
    const args =
      read === GUIDE_CALC_READS.calc
        ? { target: { session: "s", openId: "d" }, fan: [], calcPath: "" }
        : { target: { session: "s", openId: "d" }, mode: "fan", unitId: 1, portIndex: 0 };
    const raw = { read, args, subscription: `guide:${read}`, generation: 0 };
    const request = peRoutes["reads.value"].body.parse(apiInput.parse(raw));
    expect(apiInput.safeParse({ ...raw, args: {} }).success, read).toBe(false);
    const definition = registeredReads.reads.get(read);
    expect(definition, read).toBeDefined();
    const bound = graphRoute("reads.value", request);
    expect(bound.name).toBe(read);
    expect(bound.args).toEqual(definition!.input.parse(args));
  }
});
test.each(["ducts.sheet", "fans.sheet", "fans.worksheet"])(
  "retired read %s is refused without an alias",
  (read) => {
    expect(() =>
      graphRoute("reads.value", { read, args: {}, subscription: "retired", generation: 0 }),
    ).toThrow(`Host read is not registered: ${read}`);
  },
);
const port = (take: InputPort["take"]): InputPort => ({
  evaluation: "test",
  origin: {},
  take,
  revision: () => 0,
});

test("the browser door binds the target in the host contract's shape", () => {
  // Mutant: always forward ExecutionTarget, including to a contract that takes DocumentRef.
  const ref = { session: "s", openId: "d" };
  const fans = hostRead(fanContracts.calc);
  expect(fans.input.parse({ fan: [], calcPath: "" })).not.toHaveProperty("target");
  expect(fans.request?.({ fan: [], calcPath: "" }, { kind: "document", ref })).toMatchObject({
    args: { target: ref },
  });
  const rooms = hostRead(roomsWorkspace);
  expect(
    rooms.request?.(rooms.input.parse({ view: null }), { kind: "document", ref }),
  ).toMatchObject({ args: { target: { kind: "document", ref } } });
});

test("Rooms recovers the chosen document's roster when a linked plan no longer exists", async () => {
  const levels = [
    {
      name: "Snowdon level",
      elevation: 0,
      views: [
        { id: 9948, name: "L2", type: "FloorPlan" },
        { id: 1371629, name: "L2", type: "CeilingPlan" },
      ],
    },
  ];
  const operations: string[] = [];
  const read = await evaluate(
    bodyOf(roomsWorkspace),
    { target: { kind: "document", ref: { session: "s", openId: "snowdon" } }, view: 7426391 },
    port(async (name, args) => {
      if (name === "document-mark") return { observedSince: 1, changedAt: null, generation: 0 };
      if (name === "work-scope")
        return { binding: "open", route: "rooms", target: null, open: args };
      if (name === "work") return null;
      if (name !== "native" || !args || typeof args !== "object" || !("key" in args))
        throw Error(`Unexpected input: ${name}`);
      operations.push(String(args.key));
      if (args.key === "rooms.snapshot")
        throw new BridgeError("That view is not in this document.", 400, {
          dispatched: true,
          issues: [
            {
              instancePath: "$.view",
              code: "RoomsViewMissing",
              message: "That view is not in this document.",
              severity: "error",
            },
          ],
        });
      if (args.key === "rooms.roster") return { body: { levels, regions: [] }, version: null };
      throw Error(`Unexpected native read: ${args.key}`);
    }),
  );
  expect(operations).toEqual(["rooms.snapshot", "rooms.roster"]);
  expect(read.data).toMatchObject({
    snapshot: { levels, regions: [] },
    unresolved: [{ id: "view", says: "Choose a level and a plan view", resolver: "person" }],
  });
});

test("each route's contract.ts declares the reads its host serves, with the host's own schemas", () => {
  const handles = contracts.flatMap(([, module]) => Object.values(module));
  expect(contracts).toHaveLength(15);
  expect(handles.map((h) => h.key).sort()).toEqual([
    "bind.picker",
    "captures.browse",
    "chat.context",
    "duct-loss.result",
    "ducts.network",
    "ducts.overview",
    "ducts.pricing",
    "ducts.roster",
    "families.view",
    "family.workspace",
    "fans.calc",
    "open.documents",
    "ops.workspace",
    "pods.author",
    "pods.roster",
    "rooms.workspace",
    "schedules.view",
    "settings.machine",
    "takeoffs.adoption",
    "takeoffs.views",
  ]);
  // Mutant: register read(name, ...) with copied schemas instead of body(handle, ...).
  for (const h of handles) {
    const served = registeredReads.reads.get(h.key) ?? bodyOf(h);
    expect(served.contract, `${h.key} declaration`).toBe(h);
    expect(shape(h.input), `${h.key} input`).toEqual(shape(served.input));
    expect(shape(h.data), `${h.key} data`).toEqual(shape(served.output));
  }
  const axes = Object.fromEntries(handles.map((h) => [h.key, h.axes]));
  // Joined, not the one hand constant: a read that walks the model no longer says Cheap Metadata.
  expect(axes["chat.context"]).toEqual({
    subject: "None",
    touches: ["Metadata"],
    effect: "Read",
    cost: "Cheap",
    cardinality: "One",
  });
  expect(axes["fans.calc"]!.cost).toBe(native("ducts.snapshot.walk").axes.cost);
  expect(axes["fans.calc"]!.touches).toEqual(
    expect.arrayContaining([...native("ducts.snapshot.walk").axes.touches]),
  );
});

test("a composition whose uses cannot join throws at host registration", () => {
  const input = z.null(),
    data = z.number();
  const orphan = contract("probe.join.orphan", { input, data, uses: [] });
  const composed = body(
    contract("probe.join.composed", { input, data, uses: [orphan, "ducts.tables"] }),
    (ctx) => ctx.read(orphan, null),
  );
  expect(() => readRegistry([{ reads: { composed } }])).toThrow(
    "Host read probe.join.composed uses 'probe.join.orphan', which has no body on this host",
  );
  body(orphan, () => 1);
  expect(readRegistry([{ reads: { composed } }]).reads.has("probe.join.composed")).toBe(true);
});

test("a keyedBy path that names no row collection refuses when the contract is minted", () => {
  const data = z
    .object({ rows: z.array(z.string()), name: z.string() })
    .and(z.object({ more: z.record(z.string(), z.number()) }));
  expect(
    contract("probe.keyed", {
      input: z.null(),
      data,
      uses: [],
      keyedBy: { rows: { kind: "name" }, more: { kind: "name" } },
    }).keyedBy,
  ).toHaveProperty("more");
  expect(() =>
    contract("probe.keyed.bad", {
      input: z.null(),
      data,
      uses: [],
      keyedBy: { name: { kind: "name" } },
    }),
  ).toThrow("Read 'probe.keyed.bad' keys 'name', which is no row collection in its data");
});

test("ctx.read(native(key)) is the native door: same body, same input, same value", async () => {
  const tables = native("ducts.tables");
  expect(bodyOf(tables)).toBe(nativeRead("ducts.tables"));
  const target = { kind: "host" as const };
  const taken: unknown[] = [];
  const probe = body(
    contract("probe.native", { input: z.null(), data: tables.data, uses: [tables] }),
    (ctx) =>
      ctx.read(tables, { request: { ids: ["CD3-2"] }, target, version: "v0", role: "acquire" }),
  );
  const value = await evaluate(
    probe,
    null,
    port(async (name, args) => {
      taken.push([name, args]);
      return {
        body: { folder: "x", tables: {}, missing: ["CD3-2"], unsupported: {} },
        version: "v1",
      };
    }),
  );
  expect(value.data.version).toBe("v1");
  expect(taken).toEqual([
    [
      "native",
      { key: "ducts.tables", request: { ids: ["CD3-2"] }, target, version: "v0", role: "acquire" },
    ],
  ]);
  // @ts-expect-error the handle's input is the native read's whole input: a bare request has no target
  void ((ctx: ReadContext) => ctx.read(tables, { ids: [] }));
});

test("the host owns a read's lifetime: the last subscriber's release stops the read, and only then", async () => {
  const signals: AbortSignal[] = [];
  const input = leaf("probe-wait", z.null(), z.number(), false);
  const definition = body(
    contract("probe.lifetime", { input: z.null(), data: z.number(), uses: [] }),
    (ctx) => ctx.read(input, null),
  );
  const publications = new Publications();
  let answer!: (value: number) => void;
  // The read's own signal reaches every input it takes.
  const waiting = port((_name, _args, _ctx, signal) => {
    signals.push(signal!);
    return new Promise<number>((resolve) => (answer = resolve));
  });
  const first = publications.publish("a", 1, definition, null, waiting);
  const second = publications.publish("b", 1, definition, null, waiting);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(signals).toHaveLength(1);
  publications.release("a", 1);
  expect(signals[0]!.aborted).toBe(false);
  publications.release("b", 1);
  expect(signals[0]!.aborted).toBe(true);
  answer(1);
  expect((await first).state).toBe("superseded");
  expect((await second).state).toBe("superseded");
  // A retiring flight is not joined: the next subscriber starts its own read.
  const third = publications.publish("c", 1, definition, null, waiting);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(signals).toHaveLength(2);
  answer(2);
  expect(await third).toMatchObject({ state: "current", value: { data: 2 } });
  expect(signals[1]!.aborted).toBe(false);
});

// The falsifier: change `data` in `duct-loss/contract.ts` only and both lines below stop compiling.
test("one declaration types the host body and the pane", () => {
  type Data = z.output<typeof ductLossData>;
  // The host body's side: `body()` takes a run that returns the contract's data.
  const hostBody = () => body(ductLoss, (): Data => ({ error: null, result: null }));
  // The pane's side: what it draws is the contract's publication.
  expectTypeOf<
    NonNullable<z.output<typeof ductLoss.output>["value"]>["data"]
  >().toEqualTypeOf<Data>();
  expect(hostBody).toBeTypeOf("function");
  // @ts-expect-error a body that returns another shape does not compile
  void (() => body(ductLoss, () => ({ error: 1, result: null })));
});
