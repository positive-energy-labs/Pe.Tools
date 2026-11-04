import {
  ductsDesign,
  ductsRouteState,
  neutralFansWork,
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
} from "@pe/agent-contracts";
import { SCENE_FIXTURE } from "./scene.fixture";
import { LAYOUT_FIXTURE, LAYOUT_ROSTER } from "./layout.fixture";
import { COLOURS_FIXTURE } from "./colours.fixture";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { pricingJob } from "./pricing-job";
import sheet from "./sheet/sheet.fixture.json";

const fixtures = {
  scene: SCENE_FIXTURE,
  layout: LAYOUT_FIXTURE,
  colours: COLOURS_FIXTURE,
  navigation: NAVIGATION_FIXTURE,
};
function seed(name: keyof typeof fixtures) {
  const fixture = fixtures[name];
  const work = ductsRouteState.schema.parse({
    claims: Object.fromEntries(
      Object.entries(fixture.claims).map(([id, value]) => [id, { suggestion: { value } }]),
    ),
  });
  const fans = ductsRosterResponseSchema.parse(
    name === "layout"
      ? {
          ...LAYOUT_ROSTER,
          rows: LAYOUT_ROSTER.rows.map((row, index) => ({
            ...row,
            uniqueId: row.uniqueId ?? `layout-fixture-${index.toString(16).padStart(8, "0")}`,
          })),
        }
      : sheet.roster,
  );
  const overview = ductsSheetOverviewSchema.parse(sheet.overview);
  const inputs = ductsSheetResponseSchema.options[4].parse(sheet.inputs);
  const open = {
    overview,
    inputs,
    elements: ductsSheetResponseSchema.options[2].parse(sheet.elements),
    legs: ductsSheetResponseSchema.options[1].parse(sheet.legs),
    worstLegs: [],
    worksheet: null,
  };
  const pricing = pricingJob()({
    id: 0,
    base: { snapshot: fixture.snapshot, grids: {}, catalogs: {} },
    doc: ductsDesign(work, neutralFansWork),
  });
  return {
    work,
    readings: {
      roster: fixture.snapshot,
      ducts: fixture.snapshot,
      tables: {},
      catalogs: { tables: {}, findings: [] },
      pricing: "result" in pricing ? pricing.result : null,
      fans,
      sheet: { rows: fans.rows, progress: null, opened: [open], open },
      sheetSnapshot: fixture.snapshot,
      meshes: null,
    },
  };
}
const source = { module: "ducts/fixtures.ts", export: "seedBodies" };
export const seedBodies = {
  seedScene: {
    kind: "seed" as const,
    slot: "seeds.scene.load" as const,
    source,
    run: () => seed("scene"),
  },
  seedLayout: {
    kind: "seed" as const,
    slot: "seeds.layout.load" as const,
    source,
    run: () => seed("layout"),
  },
  seedColours: {
    kind: "seed" as const,
    slot: "seeds.colours.load" as const,
    source,
    run: () => seed("colours"),
  },
  seedNavigation: {
    kind: "seed" as const,
    slot: "seeds.navigation.load" as const,
    source,
    run: () => seed("navigation"),
  },
};
