import { mountRoute, routeFromGraph } from "#/shell/mount";
import { scheduleSpecsAdapters } from "../schedules/route";
import { scheduleSpecsGraph } from "./graph";
export const Body = mountRoute(scheduleSpecsGraph, scheduleSpecsAdapters);
export const route = routeFromGraph(scheduleSpecsGraph, scheduleSpecsAdapters, "/schedule-specs");
