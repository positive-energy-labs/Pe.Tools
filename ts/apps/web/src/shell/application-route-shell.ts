import { createRouteShell } from "./admitted-mount";
import { sourceRouteServices } from "./source-route-services";
import { capturesSources } from "../captures/sources";

// One application inventory. Domain sources own transport; routes only name admitted entries.
export const applicationSources = { ...capturesSources() };
export const applicationRouteShell = createRouteShell(sourceRouteServices(applicationSources));
