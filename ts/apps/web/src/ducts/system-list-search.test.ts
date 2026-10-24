import { expect, test } from "vite-plus/test";
import type { DuctFinding } from "@pe/agent-contracts";
import type { HealPlan } from "@pe/ducts-domain/heal";
import { survey } from "@pe/ducts-domain/survey";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import fixture from "./fixtures/synthetic-snapshot.json";
import { systemNotes } from "./system-list-search";

test("Fix notes exclude advisory Heal rows and another system sharing the group", () => {
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
  const fixing = (notes: Map<string, { fix: number }>) =>
    [...notes].filter(([, note]) => note.fix > 0).map(([name]) => name);
  expect(fixing(systemNotes({ ...base, findings: [finding] }, null, heal))).toEqual(["SA 1"]);
  // The same Heal row still exists, but covers no finding that holds the price.
  expect(fixing(systemNotes({ ...base, findings: [] }, null, heal))).toEqual([]);
  expect(
    fixing(systemNotes({ ...base, findings: [{ ...finding, kind: "missed-join" }] }, null, null)),
  ).toEqual([]);
});
