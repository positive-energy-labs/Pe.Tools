import { expect, test } from "vite-plus/test";

import { provenanceSummary } from "./familyfoundry";

test("a plan names a cleared value as set to empty", () => {
  expect(
    provenanceSummary({
      changes: [
        {
          section: "types.cell",
          key: "Standard/Comments",
          kind: "Update",
          mappedFrom: null,
          before: "old",
          after: "",
        },
      ],
      runEffects: [],
    } as never),
  ).toBe("types.cell.Standard/Comments: set to empty");
});
