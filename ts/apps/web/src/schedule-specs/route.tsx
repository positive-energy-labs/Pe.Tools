import { mountRoute, routeFromGraph } from "#/shell/mount";
import { schedulesAdapters } from "../schedules/route";
import { scheduleSpecsGraph } from "./graph";
export const Body = mountRoute(scheduleSpecsGraph, schedulesAdapters);
export const route = routeFromGraph(scheduleSpecsGraph, schedulesAdapters, "/schedule-specs");
