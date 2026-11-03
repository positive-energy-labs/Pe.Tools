import { createElement } from "react";
import { identityCodecs } from "../shell/page-port";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { fansData, schemas, entries, fansNeutralBodies } from "./neutral";
import { DuctsPane } from "../ducts/pane-view";
import { bodies as ductsBodies, jsonCodecs } from "../ducts/kernel";
import { ductsSources } from "../ducts/sources";
const source = { module: "fans/kernel.tsx", export: "bodies" };
export const bodies = {
  ...fansNeutralBodies,
  price: ductsBodies.price,
  "sheet-roster": {
    slot: "panes.sheet-roster.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "sheet-roster" }),
  },
  "sheet-inputs": {
    slot: "panes.sheet-inputs.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "sheet-inputs" }),
  },
  "sheet-picture": {
    slot: "panes.sheet-picture.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "sheet-picture" }),
  },
  "sheet-ledger": {
    slot: "panes.sheet-ledger.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "sheet-ledger" }),
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
  codecs: jsonCodecs<typeof fansData, typeof schemas>(fansData),
  sources: ductsSources(),
};
