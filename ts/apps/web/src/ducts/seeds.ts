// TODO: docs/features/routes/LEDGER.md#s7-f63daadbf0 Add mesh-backed fixture evidence for combined multi-fan geometry; this seed proves UI state only.
import {
  ductsRouteState,
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
  stagedDucts,
  type DuctsFirm,
  type GraphSeedData,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { resolveCriteria } from "@pe/ducts-domain/sheet/index";
import { SCENE_FIXTURE } from "./scene.fixture";
import { LAYOUT_FIXTURE, LAYOUT_ROSTER } from "./layout.fixture";
import { COLOURS_FIXTURE } from "./colours.fixture";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { pricingJob } from "./pricing-job";
import { selectedFans } from "./sheet/model";
import type { DuctsPage } from "./graph";
import sheetFixture from "./sheet/sheet.fixture.json";

const sheetInputs = ductsSheetResponseSchema.parse(sheetFixture.inputs);
if (sheetInputs.kind !== "inputs") throw Error("sheet.fixture.json inputs is not an inputs detail");
/** The fixture's criteria values become the firm layer; Work edits resolve over it like the host's. */
const firm: DuctsFirm = {
  version: sheetInputs.firm.version,
  criteria: Object.fromEntries(
    Object.entries(sheetInputs.inputs.criteria).map(([key, c]) => [
      key,
      "value" in c ? c.value : { supply: c.supply.value, return: c.return.value },
    ]),
  ) as DuctsFirm["criteria"],
};

export const ductsSeeds = Object.fromEntries(
  Object.entries({
    scene: SCENE_FIXTURE,
    layout: LAYOUT_FIXTURE,
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
    const fans =
      name === "scene" || name === "layout"
        ? ductsRosterResponseSchema.parse(
            name === "layout"
              ? {
                  ...LAYOUT_ROSTER,
                  rows: LAYOUT_ROSTER.rows.map((row, index) =>
                    index < sheetFixture.roster.rows.length
                      ? row
                      : { ...row, uniqueId: `layout-fixture-${index.toString(16).padStart(8, "0")}` },
                  ),
                }
              : sheetFixture.roster,
          )
        : null;
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
        fans,
        // Keyed on Work revision by the fixture lane (shell/fixture.ts), so an edit re-resolves here.
        sheet: (page: DuctsPage, doc: DuctsRouteDocument | null) => {
          const inputs = {
            ...sheetInputs,
            inputs: {
              ...sheetInputs.inputs,
              criteria: resolveCriteria(stagedDucts(doc), null, firm),
            },
          };
          const picked = selectedFans(page.fan, fans?.rows ?? []);
          // Synthetic layout evidence: each picked roster row has an independent overview.
          const opened = picked.map((row) => ({
            overview: ductsSheetOverviewSchema.parse({
              ...sheetFixture.overview,
              fan: { ...sheetFixture.overview.fan, ...row },
              totals: {
                ...sheetFixture.overview.totals,
                requiredEspInWg: row.requiredEspInWg ?? null,
              },
            }),
            inputs,
            elements: ductsSheetResponseSchema.parse(sheetFixture.elements),
            legs: ductsSheetResponseSchema.parse(sheetFixture.legs),
            worstLegs: [],
            worksheet: null,
          }));
          return { rows: fans?.rows ?? [], progress: null, opened, open: opened[0] ?? null };
        },
        sheetSnapshot: fixture.snapshot,
      },
    };
    return [name, seed];
  }),
);
