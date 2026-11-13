import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { contract } from "@pe/agent-contracts/handle";
import { hostRead } from "./host-read.ts";

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
