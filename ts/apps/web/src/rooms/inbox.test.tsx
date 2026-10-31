import { roomsRouteState, type Mark } from "@pe/agent-contracts";
import type { RoomsSnapshot } from "@pe/host-contracts/generated";
import { expect, test } from "vite-plus/test";

import { inboxCards } from "./cards";

const VIEW = "L1 - Rooms";
const square = (x: number, y: number, w: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + w],
  [x, y + w],
];
type Region = RoomsSnapshot.Res.RoomsRegion;
const region = (guid: string, name: string, x: number): Region => ({
  elementId: 1,
  guid,
  view: VIEW,
  level: "L1",
  role: "room",
  zone: "z",
  designation: null,
  name,
  type: "hall",
  ceilingFt: null,
  people: null,
  lightingW: null,
  equipSensible: null,
  equipLatent: null,
  ventilationCfm: null,
  sqft: 100,
  outer: square(x, 0, 10),
  holes: [],
  label: [x + 5, 5],
  runId: "r1",
  reason: null,
  touched: false,
  locked: false,
  stale: false,
});
const snapshot: RoomsSnapshot.Res.Response = {
  levels: [{ name: "L1", elevation: 0, views: [VIEW] }],
  regions: [region("a", "Kitchen", 0), region("b", "Nook", 10), region("c", "Closet", 30)],
};
const mark = (kind: Mark["kind"], polygon: [number, number][], guids: string[]): Mark => ({
  kind,
  anchor: { view: VIEW, level: "L1", polygon },
  run: "r1",
  guids,
});

test("a rerun rechurns every guid; a card still finds its regions by the anchor's geometry", () => {
  // The reject edit on run r1's face, then the rerun held it under a new id.
  const rerun = {
    ...snapshot,
    regions: [
      { ...region("a2", "Kitchen", 0), runId: "r2" },
      { ...region("b2", "Nook", 10), runId: "r2" },
      { ...region("c2", "Closet", 30), runId: "r2", role: "held" as const, reason: "rejected" },
    ],
  };
  const work = roomsRouteState.schema.parse({
    marks: { m1: { edit: { value: mark("reject", square(30, 0, 10), ["c"]) } } },
  });
  expect(inboxCards(work, snapshot, VIEW)[0]!.guids).toEqual(["c"]);
  expect(inboxCards(work, rerun, VIEW)[0]!.guids).toEqual(["c2"]);
});
