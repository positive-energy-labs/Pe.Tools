import { expect, it } from "vite-plus/test";
import { routeVerbJsonSchema } from "./route-kernel-data.ts";
import type { BodyBindings } from "./route-kernel-bodies.ts";
import { builtinData, entries, schemas } from "./route-kernel.fixtures.ts";
const query = {
  kind: "query",
  input: "text",
  label: "Read",
  review: "none",
  deps: { page: [], work: [], readings: [] },
  captures: [],
  entry: "apply",
  args: "args",
  cancellation: "scope",
  lands: "land",
} as const;
const data = { ...builtinData, verbs: { read: query } } as const;
type Bodies = BodyBindings<typeof data, typeof schemas, typeof entries, string>;
export const land: Bodies["land"] = {
  kind: "lands",
  slot: "verbs.read.lands",
  source: { module: "bodies.ts", export: "land" },
  run: (result, page) => ({ search: `${page.search}:${result.changed}` }),
};
export const wrong: Bodies["land"] = {
  ...land,
  // @ts-expect-error Query landing receives decoded output, never input.
  run: (result) => ({ search: String(result.amount) }),
};
it("allows nonempty query landing references", () => {
  expect(routeVerbJsonSchema.safeParse(query).success).toBe(true);
  expect(routeVerbJsonSchema.safeParse({ ...query, lands: "" }).success).toBe(false);
});
