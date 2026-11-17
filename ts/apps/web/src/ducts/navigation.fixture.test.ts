import { networkCalcs } from "@pe/ducts-domain/sheet/network-calcs";
import { FIRM_SEED } from "@pe/ducts-domain/input-layers";
import { expect, test } from "vite-plus/test";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { systemScope, systemsOf } from "@pe/ducts-domain/system-scope";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { SCENE_FIXTURE } from "./scene.fixture";
import { designOf } from "@pe/ducts-domain/test-design";
import { pricingValue, pricingWire } from "./pricing-value";

test("navigation fixture reaches production pricing with three systems, long lists and a shared finding", () => {
  const { snapshot, grids } = NAVIGATION_FIXTURE;
  const value = pricingValue(snapshot, networkCalcs(snapshot, grids, EMPTY_CATALOGS, designOf({}), FIRM_SEED, 0), designOf({}));
  const { survey: priced, analysis, calcs } = value;
  // The read's own contract decodes what the body computes: every calc, the survey and the analysis.
  expect(pricingWire(value).calcs).toHaveLength(calcs.length);
  // Every roster fan gets its own calc; none is a group's.
  expect(new Set(calcs.map((calc) => `${calc.fan.unitId}:${calc.fan.portIndex}`)).size).toBe(calcs.length);
  expect(analysis.systems.map((system) => system.name).sort()).toEqual([
    "EA Lab",
    "SA Lab",
    "SA Office",
  ]);
  for (const system of systemsOf(priced.snapshot)) {
    const scope = systemScope(priced.snapshot, system.name);
    expect(scope.terminals.size).toBe(16);
    expect(scope.members.size).toBeGreaterThan(30);
  }
  const shared = priced.findings.find((finding) => finding.id.startsWith("open-end:1002:"));
  expect(shared?.elementIds).toContain(1002);
  expect(systemScope(priced.snapshot, "SA Office").members.has(1002)).toBe(true);
  expect(systemScope(priced.snapshot, "SA Lab").members.has(1002)).toBe(true);
  expect(systemScope(priced.snapshot, "EA Lab").members.has(1002)).toBe(false);
  // The scene story remains its original ungrouped trace.
  expect(SCENE_FIXTURE.snapshot.groups).toEqual([]);
  expect(SCENE_FIXTURE.snapshot.systems).toEqual([]);
});
