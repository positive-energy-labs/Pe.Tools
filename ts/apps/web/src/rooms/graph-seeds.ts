import { roomsRouteState } from "@pe/agent-contracts";
import { DEMO_PLAN, DEMO_ROOMS, DEMO_TRACE, DEMO_VIEW } from "./demo";
export const roomsSeeds = {
  plan: {
    title: "Room plan",
    page: { view: DEMO_VIEW },
    work: roomsRouteState.schema.parse({}),
    readings: { snapshot: DEMO_ROOMS, trace: DEMO_TRACE, plan: { plan: DEMO_PLAN }, receipts: [] },
    queries: { "rooms.refresh": DEMO_ROOMS },
  },
};
