import { test, expect } from "vite-plus/test";
import { presentFamilyPlan } from "./review";
test("review includes exact before and structured after values for every change", () => {
  const review = presentFamilyPlan({
    plan: {
      plan: [
        {
          familyName: "Magna3",
          changes: [
            {
              kind: "Update",
              key: "Type/Amperage",
              before: "1.01 A",
              after: { value: "1.1", unit: "Amperes" },
            },
          ],
          refusals: [],
          warnings: [],
          runEffects: [],
        },
      ],
    },
  });
  expect(review.rows.join("\n")).toContain('1.01 A \u2192 1.1 Amperes');
});
