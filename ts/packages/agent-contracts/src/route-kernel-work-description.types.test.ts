import { expect, test } from "vite-plus/test";
import type { BodyBindings } from "./route-kernel-bodies.ts";
import { builtinData, schemas, entries } from "./route-kernel.fixtures.ts";
const data = {
  ...builtinData,
  verbs: { ...builtinData.verbs, edit: { ...builtinData.verbs.edit, describe: "describeEdit" } },
} as const;
type Describe = BodyBindings<typeof data, typeof schemas, typeof entries, string>["describeEdit"];
export const describe: Describe = {
  slot: "verbs.edit.describe",
  kind: "describe",
  source: { module: "test.ts", export: "describe" },
  run: (input, ctx) => {
    const amount: number = input.amount;
    // @ts-expect-error No captured evidence or invocation authority in description context.
    void ctx.captures;
    // @ts-expect-error Only declared Page dependencies are available.
    void ctx.page.hidden;
    // @ts-expect-error Only declared Work dependencies are available.
    void ctx.work.hidden;
    // @ts-expect-error Only declared readings are available.
    void ctx.readings.hidden;
    return `Amount ${amount}`;
  },
};
export const asyncDescription: Describe = {
  ...describe,
  // @ts-expect-error Description must synchronously return a string.
  run: async () => "late",
};
export const numberDescription: Describe = {
  ...describe,
  // @ts-expect-error Numeric labels cannot be persisted.
  run: () => 42,
};
test("description slot keeps its input-first synchronous signature", () => {
  expect(describe.slot).toBe("verbs.edit.describe");
});
