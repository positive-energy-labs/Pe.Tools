import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { contract } from "@pe/agent-contracts/handle";
import { hostRead } from "./host-read.ts";

test("lazy fixture providers load on demand and refuse unregistered names", async () => {
  let loaded = 0;
  const read = hostRead(contract("example.lazy", { input: z.object({}), data: z.number(), uses: [] }), async () => {
    loaded++;
    return { scene: () => ({ data: 42, coverage: { requested: [], covered: [], unknown: [], refused: [] } }) };
  });
  expect(loaded).toBe(0);
  expect((await read.source.provide!("scene", {})).value?.data).toBe(42);
  expect(loaded).toBe(1);
  await expect(read.source.provide!("missing", {})).rejects.toThrow("No fixture 'missing'");
});

test("union read inputs retain member validation", () => {
  const input = z.union([
    z.object({ kind: z.literal("a"), a: z.string() }),
    z.object({ kind: z.literal("b"), b: z.number() }),
  ]);
  const read = hostRead(contract("example.union", { input, data: z.number(), uses: [] }));
  const member: z.output<typeof input> = read.input.parse({ kind: "a", a: "valid" });
  expect(member).toEqual({ kind: "a", a: "valid" });
  expect(read.input).toBe(input);
  expect(read.input.safeParse({ kind: "b", b: "invalid" }).success).toBe(false);
  expect(read.request?.({ kind: "b", b: 2 })).toEqual({ read: "example.union", args: { kind: "b", b: 2 } });
});

test("discriminated unions pass through unchanged and request() validates a raw transform input", () => {
  const input = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("a"), a: z.string() }),
    z.object({ kind: z.literal("b"), b: z.number() }),
  ]);
  const read = hostRead(contract("example.discriminated", { input, data: z.number(), uses: [] }));
  expect(read.input).toBe(input);
  expect(read.input.parse({ kind: "b", b: 2 })).toEqual({ kind: "b", b: 2 });
  const transform = z.string().transform((value) => value.length);
  // B48: this exercises request() directly, not the mount path's repeated parsing.
  const transformed = hostRead(contract("example.transform", { input: transform, data: z.number(), uses: [] }));
  expect(transformed.input).toBe(transform);
  expect(transformed.input.parse("abc")).toBe(3);
  expect(transformed.request?.("abc")).toEqual({ read: "example.transform", args: 3 });
});

test("refined object inputs retain checks when the browser target is removed", () => {
  const base = z.strictObject({ n: z.number(), target: z.object({ kind: z.literal("host") }) });
  for (const input of [
    base.refine((value) => value.n > 0),
    base.check(z.refine((value) => value.n > 0)),
  ]) {
    const read = hostRead(contract("example.refined", { input, data: z.number(), uses: [] }));
    expect(Object.keys(read.input.shape)).toEqual(["n"]);
    expect(read.input.parse({ n: 1 })).toEqual({ n: 1 });
    expect(read.input.safeParse({ n: -1 }).success).toBe(false);
    expect(read.request?.({ n: 1 })).toEqual({ read: "example.refined", args: { n: 1, target: { kind: "host" } } });
  }
});

test("browser read inputs validate fields and bind the target only on the host request", () => {
  const read = hostRead(contract("example.read", {
    input: z.strictObject({ count: z.number().int().positive(), target: z.object({ kind: z.literal("host") }) }),
    data: z.number(),
    uses: [],
  }));
  expect(read.input.parse({ count: 2 })).toEqual({ count: 2 });
  expect(read.input.safeParse({ count: "2" }).success).toBe(false);
  expect(read.input.safeParse({ count: -1 }).success).toBe(false);
  expect(read.input.safeParse({ count: 2, extra: true }).success).toBe(false);
  expect(read.input.safeParse({ count: 2, target: { kind: "host" } }).success).toBe(false);
  expect(read.request?.({ count: 2 })).toEqual({ read: "example.read", args: { count: 2, target: { kind: "host" } } });
});

test("a read without a target retains its schema defaults", () => {
  const read = hostRead(contract("example.local", {
    input: z.object({ count: z.number().default(3) }),
    data: z.number(),
    uses: [],
  }));
  expect(read.input.parse({})).toEqual({ count: 3 });
  expect(read.request?.({ count: 3 })).toEqual({ read: "example.local", args: { count: 3 } });
});
