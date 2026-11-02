import { test, expect } from "vite-plus/test";
import { reviewChanges } from "./review-value";
test("nested plans retain exact scalar, structured, empty and null changes", () => {
  expect(
    reviewChanges({
      response: {
        plan: [
          {
            changes: [
              {
                kind: "Update",
                key: "current",
                before: "1.01 A",
                after: { value: "1.1", unit: "Amperes" },
              },
              { kind: "Clear", key: "text", before: "", after: null },
            ],
          },
        ],
      },
    }),
  ).toEqual([
    'Update current: 1.01 A \u2192 {"value":"1.1","unit":"Amperes"}',
    "Clear text:  \u2192 null",
  ]);
});
