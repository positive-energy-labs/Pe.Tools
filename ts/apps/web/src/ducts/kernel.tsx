import { jsonCodec } from "../../../../packages/agent-contracts/src/route-kernel-codecs";
import { pricingJob } from "./pricing-job";
import { createElement } from "react";
import { identityCodecs } from "../shell/page-port";
import type {
  BodyBindings,
  CodecBindings,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { ductsData, schemas, entries, neutralBodies } from "./neutral";
import { NetworkBody } from "./proto/e/screen";
import { ductsSources } from "./sources";
import { presentLosses, presentHeal, presentFan } from "./reviews";
import { seedBodies } from "./fixtures";
const source = { module: "ducts/kernel.tsx", export: "bodies" };
export const bodies = {
  ...neutralBodies,
  ...seedBodies,
  price: {
    slot: "readings.pricing.derive",
    kind: "derive",
    source,
    run: (ctx) => {
      const { ducts, tables, catalogs } = ctx.readings;
      if (!ducts.value || !tables.value || !catalogs.value) return null;
      const priced = pricingJob()({
        id: 0,
        base: {
          // Domain readonly sweep reached 28 files; DuctSnapshot still requires mutable arrays.
          snapshot: ducts.value as import("@pe/ducts-domain/types").DuctSnapshot,
          grids: tables.value,
          catalogs: catalogs.value.tables,
        },
        // readonly at the contract owner after U2 lands
        doc: ctx.work as import("@pe/agent-contracts").DuctsRouteDocument,
      });
      if ("error" in priced) throw Error(priced.error);
      return "result" in priced ? priced.result : null;
    },
  },

  "e-systems": {
    slot: "panes.e-systems.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(NetworkBody, { ctx, id: "e-systems" }),
  },
  "e-sidebar": {
    slot: "panes.e-sidebar.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(NetworkBody, { ctx, id: "e-sidebar" }),
  },
  "e-inputs": {
    slot: "panes.e-inputs.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(NetworkBody, { ctx, id: "e-inputs" }),
  },
  "e-rules-all": {
    slot: "panes.e-rules-all.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(NetworkBody, { ctx, id: "e-rules-all" }),
  },
  "e-rules": {
    slot: "panes.e-rules.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(NetworkBody, { ctx, id: "e-rules" }),
  },
  "e-picture": {
    slot: "panes.e-picture.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(NetworkBody, { ctx, id: "e-picture" }),
  },
  "e-inbox": {
    slot: "panes.e-inbox.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(NetworkBody, { ctx, id: "e-inbox" }),
  },
  presentLosses: {
    slot: "verbs.losses.present",
    kind: "present",
    source,
    run: presentLosses,
  },
  presentHeal: {
    slot: "verbs.heal.present",
    kind: "present",
    source,
    run: presentHeal,
  },
  presentFan: {
    slot: "verbs.assign.present",
    kind: "present",
    source,
    run: presentFan,
  },
} satisfies BodyBindings<typeof ductsData, typeof schemas, typeof entries>;
export const codecs = {
  threadSearch: jsonCodec(schemas.threadSearch),
  threadSort: jsonCodec(schemas.threadSort),
  stage: jsonCodec(schemas.networkStage),
  contextRadiusFt: jsonCodec(schemas.contextRadiusFt),
  sceneView: jsonCodec(schemas.sceneView),
  system: jsonCodec(schemas.system),
  systemSearch: jsonCodec(schemas.systemSearch),
  systemSort: jsonCodec(schemas.systemSort),
  rulingSearch: jsonCodec(schemas.rulingSearch),
  rulingSort: jsonCodec(schemas.rulingSort),
  treeSearch: jsonCodec(schemas.treeSearch),
  treeSort: jsonCodec(schemas.treeSort),
  inputSearch: jsonCodec(schemas.inputSearch),
  inputSort: jsonCodec(schemas.inputSort),
  encoding: jsonCodec(schemas.encoding),
  layers: jsonCodec(schemas.layers),
  contextStyle: jsonCodec(schemas.contextStyle),
  picture: jsonCodec(schemas.picture),
  viewport: jsonCodec(schemas.viewport),
  fan: jsonCodec(schemas.fan),
  sheetPath: jsonCodec(schemas.sheetPath),
} satisfies CodecBindings<typeof ductsData, typeof schemas>;
export const module = {
  data: ductsData,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs,
  sources: ductsSources(),
};
