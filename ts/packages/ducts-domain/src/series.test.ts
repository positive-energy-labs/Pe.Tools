import { expect, test } from "vite-plus/test";

import { series } from "./survey.ts";
import type { DuctSnapshot } from "./types.ts";

const unit = (id: number, mark: string | null) => ({
  id,
  kind: "equipment",
  connectors: [],
  facts: mark ? [{ key: "mark", text: mark }] : [],
});

test("an unmatched unit on a matched unit's group sits in series", () => {
  const snapshot = {
    nodes: [unit(1, "FC-17"), unit(2, "DH-21"), unit(3, null), unit(4, null)],
    groups: [
      { id: "g1", rootIds: [1, 2] },
      { id: "g2", rootIds: [3, 4] },
    ],
    issues: [
      { id: "multi-root:g1", kind: "multi-root", groupId: "g1" },
      { id: "multi-root:g2", kind: "multi-root", groupId: "g2" },
    ],
  } as unknown as DuctSnapshot;
  const s = series(snapshot, new Set(["FC-17"]));
  expect(s.snapshot.groups.map((g) => g.rootIds)).toEqual([[1], [3, 4]]);
  expect(s.snapshot.issues.map((i) => i.id)).toEqual(["multi-root:g2"]);
  expect(s.findings).toMatchObject([{ id: "series:g1", elementIds: [2], clearer: "pea" }]);
});
