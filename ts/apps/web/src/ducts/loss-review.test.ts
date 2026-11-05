import { expect, test } from "vite-plus/test";
import { presentFan, presentLosses } from "./reviews";

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
    { readings: {} },
  );
  expect(review.rows[0]).not.toContain("14088043");
  expect(review.sentence).toContain("1 Revit target:");
  expect(review.rows[0]).toContain("PE_M_Grd_ExternalStaticPressure: 0 in-wg → 0.026 in-wg");
  expect(review.rows[0]).toContain("source: catalog p. 3 · refused · parameter missing");
});

test("empty native preview explains why there is nothing to write", () => {
  const review = presentLosses({ writes: [], counts: {} }, { readings: {} });
  expect(review.sentence).toMatch(/Nothing to write:.*no native targets.*selected scope/);
});

test("review rows speak Revit's words: no loss-method tokens, no store machine words", () => {
  const review = presentLosses(
    {
      response: {
        counts: { planned: 2, written: 0, refused: 0, unchanged: 0 },
        writes: [
          {
            id: 7,
            kind: "component",
            outcome: "planned",
            before: "no server",
            after: "specific-loss 0.18 in-wg",
          },
          { id: null, kind: "store", outcome: "planned", before: "absent", after: null },
        ],
      },
    },
    { readings: {} },
  );
  expect(review.rows[0]).toContain("Specific Loss: no loss method → Specific Loss 0.18 in-wg");
  expect(review.rows[1]).toBe("Pe loss record (Project Information): none yet → created · planned");
});

test("each write is a cell: before from the plan, the Work cell's author, unknown when no source names it", () => {
  const review = presentLosses(
    {
      response: {
        counts: { planned: 2, written: 0, refused: 0, unchanged: 0 },
        writes: [
          { id: 7, kind: "equipment-flow", outcome: "planned", before: "880 cfm", after: "925 cfm" },
          { id: 8, kind: "terminal", outcome: "planned" },
        ],
      },
      derivedRequest: { terminals: [{ id: 8, inWg: 0.05, source: "Work" }] },
    },
    {
      readings: {
        fansWork: {
          value: { equipmentFlows: { "7": { edit: { value: { cfm: 925 }, by: "pea" } } } } as never,
        },
      },
    },
  );
  expect(review.cells).toEqual([
    expect.objectContaining({ key: "equipment-flow:7", before: "880 cfm", author: "pea" }),
    expect.objectContaining({ key: "terminal:8", before: null, author: "unknown" }),
  ]);
  expect(review.cells[0]!.after).toContain("925 cfm");
  expect(review.cells[1]!.after).toContain("0.05 in-wg");
});

test("a fan assignment never guesses the prior fan", () => {
  const review = presentFan(
    { response: { systemId: 3, unitId: 9, outcome: "planned" } },
    { readings: {}, work: { writeIntent: { edit: { value: {}, by: "human" } } } as never },
  );
  expect(review.cells).toEqual([expect.objectContaining({ before: null, author: "human" })]);
});
