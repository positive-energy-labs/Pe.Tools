import { expect, test } from "vite-plus/test";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { stubLabels } from "./stub-labels";

test("stub names deduplicate by system and connecting unit, and anchor on their own geometry", () => {
  const { snapshot } = NAVIGATION_FIXTURE;
  const office = snapshot.segments.filter((e) => e.systemName === "SA Office");
  const lab = snapshot.segments.find((e) => e.systemName === "SA Lab")!;
  const a = office[0]!,
    b = office[1]!;
  const neighbours = [
    { group: "one", unit: 1000, systems: [], cuts: [], stub: [a.id, b.id, lab.id] },
    { group: "duplicate", unit: 1000, systems: [], cuts: [], stub: [b.id] },
    { group: "other-unit", unit: 4000, systems: [], cuts: [], stub: [a.id] },
  ];
  const labels = stubLabels(snapshot, neighbours, new Set([lab.id]));
  expect(labels.map((label) => label.key)).toEqual(["stub:1000:SA Office", "stub:4000:SA Office"]);
  expect(labels[0]).toMatchObject({ text: "SA Office", ids: [a.id, b.id], stub: true });
  expect(labels[0]!.at).toEqual(a.polyline[0]!.map((v, i) => (v + a.polyline[1]![i]!) / 2));
});
