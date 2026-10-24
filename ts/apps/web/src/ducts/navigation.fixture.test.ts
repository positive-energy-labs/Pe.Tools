import { expect, test } from "vite-plus/test";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { systemScope, systemsOf } from "@pe/ducts-domain/system-scope";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { SCENE_FIXTURE } from "./scene.fixture";
import { pricingJob } from "./pricing-job";

test("navigation fixture reaches production pricing with eight systems, long lists and a shared finding", () => {
  const { snapshot, grids } = NAVIGATION_FIXTURE;
  const answer = pricingJob()({
    id: 1,
    doc: null,
    base: { snapshot, grids, catalogs: EMPTY_CATALOGS },
  });
  if (!("result" in answer)) throw Error("error" in answer ? answer.error : "No pricing result");
  const { priced, analysis } = answer.result;
  expect(analysis.systems.map((system) => system.name).sort()).toEqual([
    "EA Lab",
    "EA Office",
    "SA East",
    "SA Lab",
    "SA North",
    "SA Office",
    "SA South",
    "SA West",
  ]);
  for (const system of systemsOf(priced.snapshot)) {
    const scope = systemScope(priced.snapshot, system.name);
    expect(scope.terminals.size).toBe(16);
    expect(scope.members.size).toBeGreaterThan(30);
  }
  const shared = priced.findings.find((finding) => finding.id === "open-end:1002");
  expect(shared?.elementIds).toContain(1002);
  expect(systemScope(priced.snapshot, "SA Office").members.has(1002)).toBe(true);
  expect(systemScope(priced.snapshot, "SA Lab").members.has(1002)).toBe(true);
  expect(systemScope(priced.snapshot, "EA Lab").members.has(1002)).toBe(false);
  // The scene story remains its original ungrouped trace.
  expect(SCENE_FIXTURE.snapshot.groups).toEqual([]);
  expect(SCENE_FIXTURE.snapshot.systems).toEqual([]);
});
