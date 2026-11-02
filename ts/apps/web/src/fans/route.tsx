import { routeFromGraph } from "#/shell/mount";
import { ductsAdapters } from "../ducts/route";
import { fansGraph } from "./graph";
export const fansRoute = routeFromGraph(fansGraph, ductsAdapters, "/fans");
