import { expect, test } from "vite-plus/test";
import type { DuctFinding } from "@pe/agent-contracts";
import type { HealPlan } from "@pe/ducts-domain/heal";
import { survey } from "@pe/ducts-domain/survey";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import fixture from "./fixtures/synthetic-snapshot.json";
import { systemsNeedingFix } from "./system-list-search";

test("Needs a fix excludes advisory Heal rows and another system sharing the group", () => {
  const snapshot = {
    ...fixture,
    groups: fixture.groups.map((group) => ({ ...group, systemNames: ["SA 1", "Other"] })),
  } as DuctSnapshot;
  const base = survey(snapshot, null);
  const finding: DuctFinding = {
    id: "open-end:g10:21:1",
    kind: "open-end",
    elementIds: [21],
    note: "Open end",
    assumed: null,
    clearer: "person",
  };
  const heal: HealPlan = {
    groups: [
      {
        group: "g10",
        items: [
          {
            key: "cap:21:1",
            kind: "cap",
            how: "cap",
            end: "21:1",
            gapIn: 0,
            ids: [21],
            covers: [finding.id],
          },
        ],
      },
    ],
    covered: new Set([finding.id]),
    hard: new Map(),
  };
  expect([...systemsNeedingFix({ ...base, findings: [finding] }, null, heal)]).toEqual(["SA 1"]);
  // The same Heal row still exists, but covers no finding that holds the price.
  expect([...systemsNeedingFix({ ...base, findings: [] }, null, heal)]).toEqual([]);
  expect([
    ...systemsNeedingFix({ ...base, findings: [{ ...finding, kind: "missed-join" }] }, null, null),
  ]).toEqual([]);
});
