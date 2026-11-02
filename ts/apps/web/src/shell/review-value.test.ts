import { test, expect } from "vite-plus/test";
import { showFamilyCell, showCellValue } from "@pe/agent-contracts";
import { reviewValue, reviewChanges } from "./review-value";
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
    'Update current: 1.01 A \u2192 1.1 Amperes',
    "Clear text:  \u2192 null",
  ]);
});

test("Pea and human units render identically in cells and generic review", () => {
  for (const unit of ["autodesk.unit.unit:amperes-1.0.1", "Amperes"]) {
    const value = { value: "1.1", unit, storageType: "Double" };
    expect(showFamilyCell(value)).toBe("1.1 Amperes");
    expect(showCellValue(value)).toBe("1.1 Amperes");
    expect(reviewValue(value)).toBe("1.1 Amperes");
    expect(reviewValue({ value: "1.1", unit })).toBe("1.1 Amperes");
  }
  expect(reviewValue({ value: "1.6666666666666665", unit: "Feet", display: "1' - 8\"" })).toBe("1' - 8\"");
  expect(reviewValue({ arbitrary: [1, 2] })).toBe('{"arbitrary":[1,2]}');
});
