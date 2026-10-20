import { expect, test } from "vite-plus/test";
import { resolveStateColumn } from "@pe/kit/table/master-table-columns";
import { readQuery } from "@pe/kit/table/view";
import { PARAMETER_DATASET, SEGMENT_DATASET, datasetQuery, type Dataset } from "./fixtures";

function checkExamples<Row>(dataset: Dataset<Row>) {
  const fields = new Set(
    dataset.columns
      .map(resolveStateColumn)
      .filter((column) => column.condition)
      .map((column) => column.label.toLowerCase()),
  );
  const sorts = new Set(
    dataset.columns
      .map(resolveStateColumn)
      .filter((column) => column.sort)
      .map((column) => column.key),
  );
  for (const preset of dataset.presets) {
    for (const clause of readQuery(preset.state.query)) {
      expect(clause.kind, `${preset.id}: malformed example`).not.toBe("broken");
      if (clause.kind === "field")
        expect(
          fields.has(clause.label.toLowerCase()),
          `${preset.id}: unknown field ${clause.label}`,
        ).toBe(true);
    }
    for (const sort of preset.state.sorts)
      expect(sorts.has(sort.key), `${preset.id}: unknown sort ${sort.key}`).toBe(true);
    expect(
      datasetQuery(dataset, preset.state).rows(preset.state.query).length,
      `${dataset.label}: ${preset.label} should demonstrate matching rows`,
    ).toBeGreaterThan(0);
  }
}

test("every duct example uses real capabilities and demonstrates matching rows", () =>
  checkExamples(SEGMENT_DATASET));
test("every parameter example uses real capabilities and demonstrates matching rows", () =>
  checkExamples(PARAMETER_DATASET));
