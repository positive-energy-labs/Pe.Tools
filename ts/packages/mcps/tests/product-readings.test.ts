import { expect, test } from "vite-plus/test";
import { resourceReadingSchema } from "../src/pea/product-contracts.generated.ts";

test("the resource parser admits built-in and product requests through the same boundary", () => {
  const requests = [
    { kind: "inventory" },
    { kind: "ducts-tables", session: "fixture", ids: ["table"] },
  ];
  expect(resourceReadingSchema.array().parse(requests)).toEqual(requests);
  expect(resourceReadingSchema.safeParse({ ...requests[1], session: "" }).success).toBe(false);
});
