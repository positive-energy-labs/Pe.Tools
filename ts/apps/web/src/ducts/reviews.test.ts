import { healPlan } from "@pe/ducts-domain/heal";
import { expect, test } from "vite-plus/test";
import { presentHeal, presentFan, presentLosses } from "./reviews";
import { ra23Snapshot, twoHealNetworksSnapshot } from "./heal.fixture";
import { snapshot } from "./test-fixture";
const scope = (ducts = structuredClone(snapshot)) => ({ heal: healPlan(ducts, null), readings: { ducts: { value: ducts } } });
test("fan review names targets from the Place sheet snapshot even when network scope is empty", () => {
  const review = presentLosses(
    {
      previewOnly: true,
      writes: [
        {
          id: 100,
          kind: "equipment",
          outcome: "planned",
          before: "0 in-wg",
          after: "0.18 in-wg",
          reason: null,
        },
      ],
      counts: { planned: 1, written: 0, refused: 0, unchanged: 0 },
    },
    {
      page: { stage: "sheet" },
      readings: {
        ducts: { value: { ...snapshot, nodes: [], segments: [] } },
        sheetSnapshot: { value: snapshot },
      },
    },
  );
  expect(review.rows[0]).toContain("FC-1");
  expect(review.rows[0]).toContain("0.18 in-wg");
});
test("two RA 37 caps name their ends' system instead of the shared group's other systems", () => {
  const ducts = twoHealNetworksSnapshot();
  ducts.groups.find((group) => group.id === "g6953999")!.systemNames = ["FA 20", "FA 27"];
  for (const segment of ducts.segments)
    if (segment.groupId === "g6953999") segment.systemName = "RA 37";
  const review = presentHeal(
    {
      previewOnly: true,
      counts: { planned: 2, healed: 0, refused: 0 },
      groups: [
        {
          group: "g6953999",
          items: [14663504, 14663546].map((id) => ({
            key: `cap:${id}:1`,
            kind: "cap",
            outcome: "planned",
            created: [],
            replaced: [],
          })),
        },
      ],
    },
    scope(ducts),
  );
  expect(review.sentence).toBe("RA 37: 2 planned");
});
test("RA 23's preview names the element and connector size without a numeric identity", () => {
  const ducts = ra23Snapshot();
  const review = presentHeal(
    {
      response: {
        previewOnly: true,
        counts: { planned: 1, healed: 0, refused: 0 },
        groups: [
          {
            group: "g10002953",
            items: [
              { key: "cap:10002955:9", kind: "cap", outcome: "planned", created: [], replaced: [] },
            ],
          },
        ],
      },
    },
    scope(ducts),
  );
  expect(review.sentence).toBe("RA 23: 1 planned");
  expect(review.rows[0]).toMatch(/^Place a cap on 8 in duct \(8 in round\).*planned/);
  expect(review.rows[0]).not.toMatch(/10002955|end 9/);
  expect(review).not.toHaveProperty("page");
});
test("refused native repairs remain readable in the shared review", () => {
  const review = presentHeal(
    {
      previewOnly: true,
      counts: { planned: 0, healed: 0, refused: 1 },
      groups: [
        {
          group: "g1",
          items: [
            {
              key: "cap:1:0",
              kind: "cap",
              outcome: "refused",
              reason: "A cap would block its air",
              created: [],
            },
          ],
        },
      ],
    },
    scope(),
  );
  expect(review.rows[0]).toContain("refused");
  expect(review.rows[0]).toContain("A cap would block its air");
});
test("fan review uses system, unit and native read-back words", () => {
  const review = presentFan(
    {
      response: {
        previewOnly: true,
        systemId: 900,
        unitId: 100,
        outcome: "planned",
        check: "base equipment checked",
      },
    },
    scope(),
  );
  expect(review.sentence).toBe("SA: base equipment checked");
  expect(review.rows).toEqual(["Make FC-1 the fan of SA: planned"]);
  expect(
    presentFan(
      { value: { systemId: 900, unitId: 100, outcome: "refused", reason: "already assigned" } },
      scope(),
    ).sentence,
  ).toBe("SA: refused: already assigned");
});
