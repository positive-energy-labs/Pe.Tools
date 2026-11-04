import { mountRoute, routeFromGraph } from "#/shell/mount";
import { takeoffAdaptersFor } from "../takeoff/graph-route";
import { rhvacSyncGraph } from "./graph";
export const Body = mountRoute(rhvacSyncGraph, takeoffAdaptersFor(rhvacSyncGraph));
export const route = routeFromGraph(rhvacSyncGraph, takeoffAdaptersFor(rhvacSyncGraph), "/rhvac-sync");
