import { mountRoute, routeFromGraph } from "#/shell/mount";
import { takeoffAdaptersFor } from "../takeoff/graph-route";
import { zoneAuditGraph } from "./graph";
export const Body = mountRoute(zoneAuditGraph, takeoffAdaptersFor(zoneAuditGraph));
export const route = routeFromGraph(zoneAuditGraph, takeoffAdaptersFor(zoneAuditGraph), "/zone-audit");
