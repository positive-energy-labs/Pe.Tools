import type { RoomsSnapshot } from "@pe/host-contracts/generated";
import type { TakeoffPlanImage } from "#/takeoff/level-plan";
import fixture from "./fixtures/trace.json";
import type { TraceData } from "./layers";

export const DEMO_VIEW = "Fixture level plan";
export const DEMO_TRACE = fixture as TraceData;
const rectangles = [
  ["zone", 0, 0, 40, 24],
  ["room", 0, 0, 20, 12],
  ["room", 20, 0, 40, 12],
  ["held", 0, 12, 40, 24],
] as const;
export const DEMO_ROOMS: RoomsSnapshot.Res.Response = {
  levels: [{ name: "Fixture level", elevation: 0, views: [DEMO_VIEW] }],
  regions: rectangles.map(([role, x, y, right, top], index) => ({
    elementId: 1001 + index,
    guid: `fixture-${index}`,
    view: DEMO_VIEW,
    level: "Fixture level",
    role,
    zone: index ? "fixture-0" : null,
    name: "",
    type: "hall",
    sqft: (right - x) * (top - y),
    outer: [
      [x, y],
      [right, y],
      [right, top],
      [x, top],
    ],
    holes: [],
    label: [(x + right) / 2, (y + top) / 2],
    runId: "fixture-run",
    touched: false,
    locked: index === 1,
    stale: index === 2,
  })),
};
export const DEMO_PLAN: TakeoffPlanImage = {
  href: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="white"/><path d="M2 2H798V478H2ZM400 0V240M0 240H800" fill="none" stroke="gray" stroke-width="4"/></svg>')}`,
  registration: {
    width: 800,
    height: 480,
    topLeft: [0, 24],
    topRight: [40, 24],
    bottomLeft: [0, 0],
  },
};
