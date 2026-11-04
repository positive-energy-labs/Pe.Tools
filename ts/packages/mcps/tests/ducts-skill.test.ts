import { ductsSheetRequestSchema } from "@pe/agent-contracts";
import { expect, test } from "vite-plus/test";

test("the fan and asserted-chain requests have one discriminated contract", () => {
  const target = { session: "dev", openId: "project" };
  expect(
    ductsSheetRequestSchema.safeParse({ target, mode: "fan", unitId: 14577391, portIndex: 2 })
      .success,
  ).toBe(true);
  expect(
    ductsSheetRequestSchema.safeParse({
      target,
      mode: "chain",
      start: { elementId: 1 },
      end: { elementId: 2 },
      direction: "return",
    }).success,
  ).toBe(true);
  expect(
    ductsSheetRequestSchema.safeParse({
      target,
      mode: "chain",
      start: { elementId: 1 },
      end: { elementId: 2 },
    }).success,
  ).toBe(false);
});
