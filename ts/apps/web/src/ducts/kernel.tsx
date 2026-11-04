import { createElement } from "react";
import { ductsDesign, neutralFansWork } from "@pe/agent-contracts";
import type {
BodyBindings,
CodecBindings,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { jsonCodec } from "../../../../packages/agent-contracts/src/route-kernel-codecs";
import { identityCodecs } from "../shell/page-port";
import { seedBodies } from "./fixtures";
import { ductsData,entries,neutralBodies,schemas } from "./neutral";
import { pricingJob,rememberAnalysis } from "./pricing-job";
import {
AllRulesBody,
InboxBody,
PictureBody,
RulesBody,
SystemsPane,
TreePane,
} from "./proto/e/screen";
import { presentFan,presentHeal,presentLosses } from "./reviews";
import { ductsSources } from "./sources";
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
      const base = {
        // Domain readonly sweep reached 28 files; DuctSnapshot still requires mutable arrays.
        snapshot: ducts.value as import("@pe/ducts-domain/types").DuctSnapshot,
        grids: tables.value,
        catalogs: catalogs.value.tables,
      };
      // U4 wires the real fans Work here.
      const doc = ductsDesign(ctx.work, neutralFansWork);
      const priced = pricingJob()({ id: 0, base, doc });
      if ("error" in priced) throw Error(priced.error);
      if ("result" in priced) {
        rememberAnalysis({ ...base, doc }, priced.result);
        return priced.result;
      }
      return null;
    },
  },

  "e-systems": {
    slot: "panes.e-systems.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(SystemsPane, { ctx }),
  },
  "e-sidebar": {
    slot: "panes.e-sidebar.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(TreePane, { ctx }),
  },
  "e-rules-all": {
    slot: "panes.e-rules-all.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(AllRulesBody, { ctx }),
  },
  "e-rules": {
    slot: "panes.e-rules.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(RulesBody, { ctx }),
  },
  "e-picture": {
    slot: "panes.e-picture.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(PictureBody, { ctx }),
  },
  "e-inbox": {
    slot: "panes.e-inbox.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(InboxBody, { ctx }),
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
