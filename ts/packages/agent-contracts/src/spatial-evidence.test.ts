import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { sweepAnswerSchema } from "./spatial-evidence.ts";

it("decodes native omitted null distance as unknown, with wire enum literals", () => {
  const wire = JSON.parse(
    readFileSync(
      new URL("../tests/fixtures/spatial-evidence.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  const answer = sweepAnswerSchema.parse(wire);
  expect(answer.evidence.revision).toBeUndefined();
  expect(answer.evidence.acquisition[0]?.outcome).toBe("outside-scope");
  expect(answer.segments[0]).toMatchObject({
    verdict: "UNKNOWN",
    minGapFt: null,
    surfaceObservation: "none-observed",
  });
  expect(
    sweepAnswerSchema.safeParse({ ...wire, segments: [{ ...wire.segments[0], minGapFt: "clear" }] })
      .success,
  ).toBe(false);
});
