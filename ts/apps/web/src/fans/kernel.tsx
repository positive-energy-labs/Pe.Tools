import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { LAYOUT_FIXTURE } from "../ducts/layout.fixture.ts";
import { COLOURS_FIXTURE } from "../ducts/colours.fixture.ts";
import { NAVIGATION_FIXTURE } from "../ducts/navigation.fixture.ts";
import sheetFixture from "../ducts/sheet/sheet.fixture.json";
import { ductsDesign, fansDocumentSchema } from "@pe/agent-contracts";
import { createElement } from "react";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import { jsonCodec } from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import { InputsBody, LedgerBody, PictureBody, RosterBody, sheetSnapshot as snapshotOf } from "../ducts/sheet/mount.tsx";
import { sheetState } from "../ducts/sheet/state.ts";
import { ductsSources } from "../ducts/sources.ts";
import { identityCodecs } from "../shell/page-port.ts";
import { entries, fansData, fansNeutralBodies, schemas } from "./neutral.ts";
import { pricingJob } from "../ducts/pricing-job.ts";
import { presentLosses } from "../ducts/reviews.ts";
const source = { module: "fans/kernel.tsx", export: "bodies" };
const seed = <const K extends string>(name: K, snapshot: DuctSnapshot) => ({
  slot: `seeds.${name}.load` as const,
  kind: "seed" as const,
  source,
  run: () => {
    const rows = sheetFixture.roster.rows.filter((row) =>
      snapshot.nodes.some((node) => node.id === row.unitId),
    );
    return {
      work: fansDocumentSchema.parse({}),
      readings: {
        fans: entries["ducts.fans"].output.parse({
          ...sheetFixture.roster,
          rows,
        }),
        sheet: schemas.sheet.parse({
          rows,
          progress: null,
          opened: [],
          open: {
            overview: sheetFixture.overview,
            inputs: sheetFixture.inputs,
            elements: sheetFixture.elements,
            legs: sheetFixture.legs,
            worstLegs: [],
            worksheet: null,
          },
        }),
        sheetSnapshot: snapshot,
        meshes: null,
        tables: {},
        catalogs: { tables: {}, findings: [] },
      },
    };
  },
});
export const bodies = {
  ...fansNeutralBodies,
  // The fan's losses read their snapshot from the sheet; this route's Work is the fans document.
  presentLosses: { slot: "verbs.losses.present", kind: "present", source,
    run: (result, ctx) => presentLosses(result, { page: { stage: "sheet" }, readings: { sheetSnapshot: ctx.readings.sheetSnapshot, fansWork: { value: ctx.work } } }) },
  seedScene: seed("scene", LAYOUT_FIXTURE.snapshot),
  seedLayout: seed("layout", LAYOUT_FIXTURE.snapshot),
  seedColours: seed("colours", COLOURS_FIXTURE.snapshot),
  seedNavigation: seed("navigation", NAVIGATION_FIXTURE.snapshot),
  price: { slot: "readings.pricing.derive", kind: "derive", source, run: (ctx) => {
    const { sheetSnapshot, ductsWork, tables, catalogs } = ctx.readings;
    if (!sheetSnapshot.value || !ductsWork.value || !tables.value || !catalogs.value) return null;
    const snapshot = snapshotOf(sheetSnapshot);
    if ("kind" in snapshot) return null;
    const priced = pricingJob()({ id: 0, base: {
      snapshot, grids: tables.value, catalogs: catalogs.value.tables,
    }, doc: ductsDesign(ductsWork.value, ctx.work) });
    if ("error" in priced) throw Error(priced.error);
    return "result" in priced ? priced.result : null;
  } },
  sheetView: {
    slot: "readings.sheetView.derive",
    kind: "derive",
    source,
    run: (ctx) => sheetState(ctx.readings.sheet.value?.open ?? null),
  },
  "sheet-roster": {
    slot: "panes.sheet-roster.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(RosterBody, { ctx }),
  },
  "sheet-inputs": {
    slot: "panes.sheet-inputs.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(InputsBody, { ctx }),
  },
  "sheet-picture": {
    slot: "panes.sheet-picture.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(PictureBody, { ctx }),
  },
  "sheet-ledger": {
    slot: "panes.sheet-ledger.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(LedgerBody, { ctx }),
  },
} satisfies BodyBindings<typeof fansData, typeof schemas, typeof entries>;
export const module = {
  data: fansData,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs: {
    contextRadiusFt: jsonCodec(schemas.contextRadiusFt),
    contextStyle: jsonCodec(schemas.contextStyle),
    encoding: jsonCodec(schemas.encoding),
    fan: jsonCodec(schemas.fan),
    layers: jsonCodec(schemas.layers),
    picture: jsonCodec(schemas.picture),
    sceneView: jsonCodec(schemas.sceneView),
    sheetPath: jsonCodec(schemas.sheetPath),
    viewport: jsonCodec(schemas.viewport),
    inputSearch: jsonCodec(schemas.inputSearch),
    inputSort: jsonCodec(schemas.inputSort),
    stage: jsonCodec(schemas.sheetStage),
    rosterSearch: jsonCodec(schemas.rosterSearch),
    rosterSort: jsonCodec(schemas.rosterSort),
  },
  sources: ductsSources(),
};
