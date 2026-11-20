import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { NATIVE_BODY_VERSION_HEADER } from "@pe/agent-contracts";
import type { ReadContext } from "@pe/host-internal/read-graph";
import { evaluate } from "@pe/host-internal/reads/evaluator";
import { contract } from "@pe/agent-contracts/handle";
import { body } from "@pe/host-internal/read-graph";
import { inputPort, type ReadSources } from "../src/reads/inputs.ts";
import { hostMarks } from "../src/document-marks.ts";
import { settle } from "./effect-test.ts";

// A Pod read module as an author writes it: a plain object, typed by the host's ReadContext only.
const limits = z.object({ maxFriction: z.number().optional() });
const pod = {
  name: "hydronic.sizing.probe",
  input: z.object({ acquisitionId: z.string(), writes: z.boolean() }),
  output: z.object({ status: z.string(), maxFriction: z.number(), source: z.string() }),
  async run(ctx: ReadContext, args: { acquisitionId: string; writes: boolean }) {
    const target = { kind: "session" as const, session: "s1" };
    const { body } = await ctx.native("document.temporary.status", {
      request: { acquisitionId: args.acquisitionId },
      target,
    });
    if (args.writes)
      // @ts-expect-error a Pod read never writes: a ModelWrite leaf is not a catalog Read
      await ctx.native("pipes.apply", { request: {}, target });
    const firm = await ctx.files.firm("hydronic.sizing", limits, {});
    // Slice 2b: no shared root refuses the firm file; the read runs on its named default.
    const stated = "refused" in firm ? undefined : firm.firm.maxFriction;
    return {
      status: body.status,
      maxFriction: stated ?? 400,
      source: stated === undefined ? "default" : "firm",
    };
  },
};

const port = (firm: { path: string; json?: unknown }, calls: string[]) => {
  const source: ReadSources = {
    workKey: async () => {
      throw Error("No Work in this probe");
    },
    resource: async () => {
      throw Error("No resources in this probe");
    },
    file: async (name, args) => {
      calls.push(`file:${name}:${String(args)}`);
      if (name !== "firm") throw Error(`Unexpected file ${name}`);
      return firm;
    },
    call: async (key) => {
      calls.push(`native:${key}`);
      return new Response(
        JSON.stringify({ acquisitionId: "a1", status: "open", recoveryId: "r1" }),
        { headers: { [NATIVE_BODY_VERSION_HEADER]: "v1" } },
      );
    },
  };
  return inputPort({
    source,
    workspace: {} as never,
    marks: hostMarks({
      observedSince: 0,
      generation: () => 0,
      changedAt: () => null,
      subscribe: () => () => {},
    }),
    run: settle,
    evaluation: "pod-door",
    origin: () => ({ kind: "fixture" }),
    revision: () => 0,
  });
};

test("a Pod read calls a catalog Read through the tracked native door and gets the typed body", async () => {
  const calls: string[] = [];
  const value = await evaluate(
    pod,
    { acquisitionId: "a1", writes: false },
    port({ path: "firm/hydronic.sizing.json" }, calls),
  );
  expect(value.data).toEqual({ status: "open", maxFriction: 400, source: "default" });
  // The firm file is re-read before publication (a validated input); the native body is fenced by marks.
  expect(calls).toEqual([
    "native:document.temporary.status",
    "file:firm:hydronic.sizing",
    "file:firm:hydronic.sizing",
  ]);
  const names = value.trace.map((row) => row.name);
  expect(names).toEqual(
    expect.arrayContaining(["input.native.document.temporary.status", "native", "file:firm"]),
  );
});

test("the firm file resolves before the engine default", async () => {
  const calls: string[] = [];
  const value = await evaluate(
    pod,
    { acquisitionId: "a1", writes: false },
    port({ path: "firm/hydronic.sizing.json", json: { maxFriction: 300 } }, calls),
  );
  expect(value.data).toMatchObject({ maxFriction: 300, source: "firm" });
});

test("a Pod read refuses a ModelWrite leaf through the door", async () => {
  await expect(
    evaluate(pod, { acquisitionId: "a1", writes: true }, port({ path: "f" }, [])),
  ).rejects.toThrow(/not a catalog Read/);
});

test("a hand-built native leaf cannot reach a ModelWrite either: the port refuses before the bridge", async () => {
  const calls: string[] = [];
  const forged = {
    name: "pod.forged",
    input: z.null(),
    output: z.unknown(),
    run: (ctx: ReadContext) =>
      ctx.read(
        { name: "native", input: z.unknown(), output: z.unknown(), leaf: true, validate: false },
        {
          key: "pipes.apply",
          request: {},
          target: { kind: "session", session: "s1" },
          role: "none",
        },
      ),
  };
  await expect(evaluate(forged, null, port({ path: "f" }, calls))).rejects.toThrow(
    /not a catalog Read/,
  );
  expect(calls.filter((call) => call === "native:pipes.apply")).toEqual([]);
});

test("ctx.read takes a handle and runs the body registered under its key; a handle with no body refuses", async () => {
  const data = z.object({ doubled: z.number() });
  const doubled = contract("probe.doubled", { input: z.number(), data, uses: [] });
  const inner = body(doubled, (_ctx, n) => ({ doubled: n * 2 }));
  expect(inner.name).toBe("probe.doubled");
  expect(() => body(doubled, () => ({ doubled: 0 }))).toThrow("already has a body");
  const outer = body(
    contract("probe.outer", { input: z.number(), data, uses: [doubled] }),
    (ctx, n) => ctx.read(doubled, n),
  );
  expect((await evaluate(outer, 4, port({ path: "f" }, []))).data).toEqual({ doubled: 8 });
  const orphan = contract("probe.orphan", { input: z.number(), data, uses: [] });
  const asks = body(contract("probe.asks", { input: z.number(), data, uses: [orphan] }), (ctx, n) =>
    ctx.read(orphan, n),
  );
  await expect(evaluate(asks, 1, port({ path: "f" }, []))).rejects.toThrow(
    "Read 'probe.orphan' has no body on this host",
  );
});

test("the two file doors live on ctx.files only (storage ST6)", () => {
  const old = (ctx: ReadContext) => {
    // @ts-expect-error ctx.firm is ctx.files.firm
    void ctx.firm;
    // @ts-expect-error ctx.settings is ctx.files.tiers
    void ctx.settings;
    return [ctx.files.firm, ctx.files.tiers];
  };
  expect(old).toBeTypeOf("function");
});
