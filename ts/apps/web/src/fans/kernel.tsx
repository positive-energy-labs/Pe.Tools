import { createElement } from "react";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { jsonCodec } from "../../../../packages/agent-contracts/src/route-kernel-codecs";
import { seedBodies } from "../ducts/fixtures";
import { codecs, bodies as ductsBodies } from "../ducts/kernel";
import { InputsBody, LedgerBody, PictureBody, RosterBody } from "../ducts/sheet/mount";
import { sheetState } from "../ducts/sheet/state";
import { ductsSources } from "../ducts/sources";
import { identityCodecs } from "../shell/page-port";
import { entries, fansData, fansNeutralBodies, schemas } from "./neutral";
const source = { module: "fans/kernel.tsx", export: "bodies" };
export const bodies = {
  ...fansNeutralBodies,
  ...seedBodies,
  price: ductsBodies.price,
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
  presentLosses: ductsBodies.presentLosses,
  presentHeal: ductsBodies.presentHeal,
  presentFan: ductsBodies.presentFan,
} satisfies BodyBindings<typeof fansData, typeof schemas, typeof entries>;
export const module = {
  data: fansData,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs: {
    ...codecs,
    stage: jsonCodec(schemas.sheetStage),
    rosterSearch: jsonCodec(schemas.rosterSearch),
    rosterSort: jsonCodec(schemas.rosterSort),
  },
  sources: ductsSources(),
};
