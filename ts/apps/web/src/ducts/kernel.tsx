import { pricingJob } from "./pricing-job";
import type { DuctsRouteDocument } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import type { Catalogs } from "@pe/ducts-domain/catalog";
import { createElement } from "react";
import { identityCodecs } from "../shell/page-port";
import type {
  BodyBindings,
  CodecBindings,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { SchemaTable } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { ductsData, schemas, entries, neutralBodies } from "./neutral";
import { DuctsPane } from "./pane-view";
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
          snapshot: ducts.value as DuctSnapshot,
          grids: tables.value as Grids,
          catalogs: catalogs.value.tables as Catalogs,
        },
        doc: ctx.work as DuctsRouteDocument,
      });
      if ("error" in priced) throw Error(priced.error);
      return "result" in priced ? priced.result : null;
    },
  },

  "e-systems": {
    slot: "panes.e-systems.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "e-systems" }),
  },
  "e-sidebar": {
    slot: "panes.e-sidebar.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "e-sidebar" }),
  },
  "e-inputs": {
    slot: "panes.e-inputs.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "e-inputs" }),
  },
  "e-rules-all": {
    slot: "panes.e-rules-all.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "e-rules-all" }),
  },
  "e-rules": {
    slot: "panes.e-rules.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "e-rules" }),
  },
  "e-picture": {
    slot: "panes.e-picture.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "e-picture" }),
  },
  "e-inbox": {
    slot: "panes.e-inbox.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(DuctsPane, { ctx, id: "e-inbox" }),
  },
  presentLosses: {
    slot: "verbs.losses.present",
    kind: "present",
    source,
    run: (result: unknown, ctx: Parameters<typeof presentLosses>[1]) => presentLosses(result, ctx),
  },
  presentHeal: {
    slot: "verbs.heal.present",
    kind: "present",
    source,
    run: (result: unknown, ctx: Parameters<typeof presentHeal>[1]) => presentHeal(result, ctx),
  },
  presentFan: {
    slot: "verbs.assign.present",
    kind: "present",
    source,
    run: (result: unknown, ctx: Parameters<typeof presentFan>[1]) => presentFan(result, ctx),
  },
} satisfies BodyBindings<typeof ductsData, typeof schemas, typeof entries>;
const json = {
  encode: JSON.stringify,
  decode(text: string) {
    try {
      return { ok: true as const, value: JSON.parse(text) };
    } catch {
      return { ok: false as const, reason: "Malformed route value" };
    }
  },
};
export function jsonCodecs<G extends RouteGraphJson, S extends SchemaTable>(
  data: G,
): CodecBindings<G, S> {
  return Object.fromEntries(
    Object.entries(data.fields)
      .filter(([, field]) => "codec" in field)
      .map(([key]) => [key, json]),
  ) as CodecBindings<G, S>;
}
export const codecs = jsonCodecs<typeof ductsData, typeof schemas>(ductsData);
export const module = {
  data: ductsData,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs,
  sources: ductsSources(),
};
