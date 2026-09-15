import { takeoffsRouteState } from "@pe/agent-contracts";

import { defineRoute } from "#/route/manifest";
import {
  takeoffActions,
  takeoffPageSchema,
  takeoffSeeds,
  type TakeoffPage,
} from "#/takeoff/actions";

/** The static Takeoffs contract. Behavior lives in actions; mounted state lives in the controller. */
export const manifest = defineRoute({
  key: "takeoffs",
  name: "Takeoffs",
  needs: "project",
  work: takeoffsRouteState,
  readings: {
    snapshot: { kind: "takeoff-reading", target: { session: "", openId: "" } },
    rhvacVersion: (page: TakeoffPage) =>
      page.r10 ? { kind: "rhvac-file-version", path: page.r10 } : null,
    inventory: { kind: "inventory" },
    receipts: { kind: "receipts", target: { session: "", openId: "" } },
  } as never,
  page: takeoffPageSchema,
  stages: [
    { key: "adopt", word: "Adopting zones" },
    { key: "audit", word: "Auditing rooms" },
    { key: "sync", word: "Syncing RHVAC" },
  ],
  actions: takeoffActions as never,
  seeds: takeoffSeeds as never,
});
