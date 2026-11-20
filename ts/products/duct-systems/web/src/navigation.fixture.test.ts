import { publishedCalcs } from "@pe/ducts-domain/published-calcs.fixture";
import { FIRM_SEED } from "@pe/ducts-domain/input-layers";
import { expect, test } from "vite-plus/test";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { systemScope, systemsOf } from "@pe/ducts-domain/system-scope";
import { NAVIGATION_FIXTURE } from "@pe/ducts-web/navigation.fixture";
import { SCENE_FIXTURE } from "@pe/ducts-web/scene.fixture";
import { designOf } from "@pe/ducts-domain/test-design";
import { pricingValue, pricingWire } from "@pe/duct-systems-domain/pricing-value";
import { ductsLink, systemCode } from "@pe/ducts-web/identity";
import { fields, network, pricing } from "../route.ts";

test("selecting a system replaces the MA-1 repair link's read scope", () => {
  const link = new URL(
    ductsLink({ unitId: 10052051, portIndex: 1 }, {}),
    "https://fixture.invalid",
  );
  const fan = fields.fan.schema.parse(JSON.parse(link.searchParams.get("fan") ?? "null"));
  const arrival = { system: { kind: "ids" as const, ids: [] }, fan };
  const selected = { ...arrival, system: { kind: "ids" as const, ids: [systemCode("RA 28")] } };
  for (const read of [network, pricing]) {
    expect(read.args(arrival)).toEqual({ system: [], fan });
    expect(read.args(selected)).toEqual({ system: ["RA 28"], fan: null });
    expect(read.args({ ...arrival, system: { kind: "all" } })).toEqual({
      system: [],
      fan: null,
    });
  }
});

test("navigation fixture reaches production pricing with three systems, long lists and a shared finding", () => {
  const { snapshot, grids } = NAVIGATION_FIXTURE;
  const value = pricingValue(
    snapshot,
    publishedCalcs(snapshot, grids, EMPTY_CATALOGS, designOf({}), FIRM_SEED, 0),
    designOf({}),
  );
  const { survey: priced, analysis, calcs } = value;
  // The read's own contract decodes what the body computes: every calc, the survey and the analysis.
  const wire = pricingWire(value);
  expect(wire.calcs).toHaveLength(calcs.length);
  expect(wire.survey).not.toHaveProperty("edit");
  expect(wire.survey).toHaveProperty(
    "effective.parameters.terminalFlow",
    snapshot.slots.terminalFlow,
  );
  // Every roster fan gets its own calc; none is a group's.
  expect(new Set(calcs.map((calc) => `${calc.fan.unitId}:${calc.fan.portIndex}`)).size).toBe(
    calcs.length,
  );
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
