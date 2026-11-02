import { expect, test } from "vite-plus/test";
import { presentLosses } from "./reviews";
import type { VerbScope } from "#/shell/verbs";

test("fan review exposes refused targets with their requested value, slot, unit and source", () => {
  const review = presentLosses(
    {
      response: {
        counts: { planned: 0, written: 0, refused: 1, unchanged: 0 },
        writes: [
          {
            id: 14088043,
            kind: "terminal",
            outcome: "refused",
            before: "0 in-wg",
            reason: "parameter missing",
          },
        ],
      },
      receipt: {
        result: {
          derivedRequest: {
            slots: { terminalDrop: "PE_M_Grd_ExternalStaticPressure" },
            terminals: [{ id: 14088043, inWg: 0.026, source: "catalog p. 3" }],
          },
        },
      },
    },
    { readings: {} } as VerbScope,
  );
  expect(review.rows[0]).toContain("[14088043]");
  expect(review.rows[0]).toContain("PE_M_Grd_ExternalStaticPressure: 0 in-wg → 0.026 in-wg");
  expect(review.rows[0]).toContain("source: catalog p. 3 · refused · parameter missing");
});

test("empty native preview explains why there is nothing to write", () => {
  const review = presentLosses({ writes: [], counts: {} }, { readings: {} } as VerbScope);
  expect(review.sentence).toMatch(/Nothing to write:.*no native targets.*selected scope/);
});
