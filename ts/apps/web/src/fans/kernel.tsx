import sheetFixture from "../ducts/sheet/sheet.fixture.json";
import { SCENE_FIXTURE } from "../ducts/scene.fixture.ts";
import { fansDocumentSchema } from "@pe/agent-contracts";
import { createElement } from "react";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import { jsonCodec } from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import { InputsBody, LedgerBody, PictureBody, RosterBody } from "../ducts/sheet/mount.tsx";
import { sheetState } from "../ducts/sheet/state.ts";
import { ductsSources } from "../ducts/sources.ts";
import { identityCodecs } from "../shell/page-port.ts";
import { entries, fansData, fansNeutralBodies, schemas } from "./neutral.ts";
const source = { module: "fans/kernel.tsx", export: "bodies" };
export const bodies = {
  ...fansNeutralBodies,
  seedSheet: {
    slot: "seeds.sheet.load", kind: "seed", source,
    run: () => ({
      work: fansDocumentSchema.parse({}),
      readings: {
        fans: entries["ducts.fans"].output.parse(sheetFixture.roster),
        sheet: schemas.sheet.parse({ rows: sheetFixture.roster.rows, progress: null, opened: [], open: { overview: sheetFixture.overview, inputs: sheetFixture.inputs, elements: sheetFixture.elements, legs: sheetFixture.legs, worstLegs: [], worksheet: null } }),
        sheetSnapshot: SCENE_FIXTURE.snapshot,
        meshes: null,
        pricing: null,
      },
    }),
  },
  // SHIM: U4 replaces this dormant derive with pricing that reads both Works.
  price: { slot: "readings.pricing.derive", kind: "derive", source, run: () => null },
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
