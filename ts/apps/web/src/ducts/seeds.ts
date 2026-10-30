import {
  ductsRouteState,
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
  type GraphSeedData,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { SCENE_FIXTURE } from "./scene.fixture";
import { COLOURS_FIXTURE } from "./colours.fixture";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { pricingJob } from "./pricing-job";
import type { DuctsPage } from "./graph";
import sheetFixture from "./sheet/sheet.fixture.json";

export const ductsSeeds = Object.fromEntries(
  Object.entries({
    scene: SCENE_FIXTURE,
    colours: COLOURS_FIXTURE,
    navigation: NAVIGATION_FIXTURE,
  }).map(([name, fixture]) => {
    const work = ductsRouteState.schema.parse({
      claims: Object.fromEntries(
        Object.entries(fixture.claims).map(([id, value]) => [id, { suggestion: { value } }]),
      ),
    });
    const pricing = pricingJob()({
      id: 0,
      base: { snapshot: fixture.snapshot, grids: {}, catalogs: EMPTY_CATALOGS },
      doc: work,
    });
    const seed: GraphSeedData<DuctsPage, DuctsRouteDocument> = {
      work,
      page: { stage: "network" },
      readings: {
        meshes: "meshes" in fixture ? fixture.meshes : null,
        roster: fixture.snapshot,
        ducts: fixture.snapshot,
        tables: {},
        catalogs: { tables: EMPTY_CATALOGS, findings: [] },
        pricing: "result" in pricing ? pricing.result : null,
        fans: name === "scene" ? ductsRosterResponseSchema.parse(sheetFixture.roster) : null,
        sheet:
          name === "scene"
            ? {
                rows: ductsRosterResponseSchema.parse(sheetFixture.roster).rows,
                progress: null,
                open: {
                  overview: ductsSheetOverviewSchema.parse(sheetFixture.overview),
                  inputs: ductsSheetResponseSchema.parse(sheetFixture.inputs),
                  elements: ductsSheetResponseSchema.parse(sheetFixture.elements),
                  legs: ductsSheetResponseSchema.parse(sheetFixture.legs),
                  worstLegs: [],
                  worksheet: null,
                },
              }
            : { rows: [], progress: null, open: null },
        sheetSnapshot: fixture.snapshot,
      },
    };
    return [name, seed];
  }),
);
