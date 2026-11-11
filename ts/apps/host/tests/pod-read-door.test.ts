import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { NATIVE_BODY_VERSION_HEADER } from "@pe/agent-contracts";
import type { ReadContext } from "@pe/host/read-graph";
import { evaluate } from "@pe/host/reads/evaluator";
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
      await ctx.native("ducts.apply", { request: {}, target });
    const firm = await ctx.firm("hydronic.sizing", limits, {});
    const maxFriction = firm.firm.maxFriction ?? 400;
    return {
      status: body.status,
      maxFriction,
      source: firm.firm.maxFriction === undefined ? "default" : "firm",
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
  const value = await evaluate(pod, { acquisitionId: "a1", writes: false }, port({ path: "firm/hydronic.sizing.json" }, calls));
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
        { key: "ducts.apply", request: {}, target: { kind: "session", session: "s1" }, role: "none" },
      ),
  };
  await expect(evaluate(forged, null, port({ path: "f" }, calls))).rejects.toThrow(
    /not a catalog Read/,
  );
  expect(calls.filter((call) => call === "native:ducts.apply")).toEqual([]);
});
