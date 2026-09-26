import {
  takeoffDecisionAddress,
  takeoffEditAddress,
  takeoffsRouteState,
  type TakeoffsRouteDocument,
} from "@pe/agent-contracts";

import { defineRoute } from "#/route/manifest";
import {
  takeoffActions,
  takeoffPageSchema,
  takeoffSeeds,
  type TakeoffPage,
  type TakeoffReadingKey,
} from "#/takeoff/actions";

/** The static Takeoffs contract. Behavior lives in actions; mounted state lives in the controller. */
export const manifest = defineRoute<
  TakeoffsRouteDocument,
  TakeoffReadingKey,
  TakeoffPage,
  keyof typeof takeoffActions
>({
  key: "takeoffs",
  name: "Takeoffs",
  docs: "Choose a project input, adopt its zones, then audit and synchronize the resulting takeoff readings before using them downstream.",
  needs: "project",
  work: takeoffsRouteState,
  cells: [
    {
      segment: "edits",
      groupOf: (key) => [takeoffEditAddress(key).roomId],
      nouns: ["room"],
      noun: "room edits",
      // A room edit's staged rung needs its room's base, read from the world in the route: the
      // head counts edits but does not stage one whose room has no base.
      admit: (doc, patches) =>
        patches.some(
          (patch) =>
            patch.path[0] === "edits" &&
            patch.path[2] === "staged" &&
            !doc.bases[takeoffEditAddress(String(patch.path[1])).roomId],
        )
          ? {
              code: "not-ready",
              message: "accept a room's first edit in Takeoffs, where the room's base is read",
            }
          : null,
    },
    { segment: "adopt", groupOf: (key) => [key.split(":")[0]!], noun: "adoption" },
    {
      segment: "decisions",
      groupOf: (key) => [takeoffDecisionAddress(key).roomGuid],
      noun: "flag verdicts",
    },
    {
      segment: "reviewFlags",
      groupOf: (key) => [(JSON.parse(key) as string[])[0]!],
      noun: "review flags",
    },
  ],
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
  actions: takeoffActions,
  seeds: takeoffSeeds as never,
});
