import { ductsDocumentSchema } from "@pe/agent-contracts";
import { fansSheetData, openFanSheetSchema } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { LAYOUT_FIXTURE } from "../ducts/layout.fixture.ts";
import { COLOURS_FIXTURE } from "../ducts/colours.fixture.ts";
import { NAVIGATION_FIXTURE } from "../ducts/navigation.fixture.ts";
import sheetFixture from "../ducts/sheet/sheet.fixture.json";
import { fansDocumentSchema } from "@pe/agent-contracts";
import { createElement } from "react";
import type { BodyBindings } from "@pe/agent-contracts";
import { jsonCodec } from "@pe/agent-contracts";
import { InputsBody, LedgerBody, PictureBody, RosterBody } from "../ducts/sheet/mount.tsx";
import { sheetState } from "../ducts/sheet/state.ts";
import { fansValueSource } from "./sources.ts";
import { identityCodecs } from "../shell/page-port.ts";
import { entries, fansData, fansNeutralBodies, schemas } from "./neutral.ts";

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
    const open = openFanSheetSchema.parse({ overview: sheetFixture.overview, inputs: sheetFixture.inputs, elements: sheetFixture.elements,
      legs: sheetFixture.legs, worstLegs: [], worksheet: null });
    const data = fansSheetData.parse({ open, opened: [], rows, progress: null, fans: { ...sheetFixture.roster, rows },
      sheetSnapshot: snapshot, sheetView: sheetState(open), ductsWork: ductsDocumentSchema.parse({}), fansWork: fansDocumentSchema.parse({}) });
    return { work: data.fansWork, readings: {
      fans: data.fans, sheet: data, sheetSnapshot: data.sheetSnapshot, meshes: null,
      value: { key: `fixture:${name}`, generation: 0, version: 1, state: "current" as const,
        value: { data, evaluation: `fixture:${name}`, origin: { kind: "fixture", name }, trace: [],
          coverage: { requested: [], covered: [], unknown: [], refused: [] }, freshness: "current" as const } },
    } };
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
  fans: { slot: "readings.fans.derive", kind: "derive", source, run: ctx => ctx.readings.value.value?.value?.data.fans ?? null },
  sheet: { slot: "readings.sheet.derive", kind: "derive", source, run: ctx => ctx.readings.value.value?.value?.data ?? null },
  sheetSnapshot: { slot: "readings.sheetSnapshot.derive", kind: "derive", source, run: ctx => ctx.readings.value.value?.value?.data.sheetSnapshot ?? { kind: "absent" as const } },
  sheetView: { slot: "readings.sheetView.derive", kind: "derive", source, run: ctx => ctx.readings.value.value?.value?.data.sheetView ?? sheetState(null) },
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
  sources: { "fans.sheet": fansValueSource() },
};
