import { lazy, type ComponentType } from "react";
import { createRouteRegistry } from "@pe/kit/route-registry";
import { openGraph } from "#/open/graph";
import { parameterLinksGraph } from "#/parameter-links/graph";
import { podsGraph } from "#/pods/graph";
import { takeoffGraph } from "#/takeoff/graph";
import { roomsGraph } from "#/rooms/graph";
import { familyGraph } from "#/family/graph";
import { familiesGraph } from "#/families/graph";
import { schedulesGraph } from "#/schedules/graph";
import { settingsGraph } from "#/settings/graph";
import { ductsGraph } from "#/ducts/graph";
import { mountRoute, type MountRouteProps } from "#/shell/mount";

/** A route body stays out of the shell chunk until a pane mounts it. */
const named = <K extends string, P>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));
const PodsRoute = named(() => import("#/pods/route"), "PodsRoute");
const ParameterLinksRoute = named(() => import("#/parameter-links/route"), "ParameterLinksRoute");
const TakeoffsPane = named(() => import("#/takeoff/pane"), "TakeoffsPane");
const OpenPage = lazy(async () => ({
  default: mountRoute(openGraph, (await import("#/open/route")).openAdapters),
}));
const RoomsRoute = named(() => import("#/rooms/route"), "RoomsRoute");
const FamilyRoute = lazy(async () => ({
  default: mountRoute(familyGraph, (await import("#/family/route")).familyAdapters),
}));
const FamiliesRoute = lazy(async () => ({
  default: mountRoute(familiesGraph, (await import("#/families/route")).familiesAdapters),
}));
const SchedulesRoute = lazy(async () => ({
  default: mountRoute(schedulesGraph, (await import("#/schedules/route")).schedulesAdapters),
}));
const DuctsRoute = lazy(async () => ({
  default: mountRoute(ductsGraph, (await import("#/ducts/route")).ductsAdapters),
}));

const SettingsRoute = lazy(async () => ({
  default: mountRoute(settingsGraph, (await import("#/settings/route")).settingsAdapters),
}));
export const publicRoutes = createRouteRegistry();
publicRoutes.registerGraph(settingsGraph, hosted(SettingsRoute));
publicRoutes.registerGraph(openGraph, hosted(OpenPage));
publicRoutes.registerGraph(takeoffGraph, ({ visible, ...binding }) => (
  <TakeoffsPane {...binding} hidden={!visible} url={false} />
));
function hosted(Body: ComponentType<MountRouteProps>) {
  return ({
    visible,
    ...binding
  }: {
    thread: string;
    visible: boolean;
    target?: string;
    work?: string;
  }) => <Body {...binding} hidden={!visible} url={false} />;
}
publicRoutes.registerGraph(roomsGraph, hosted(RoomsRoute));
publicRoutes.registerGraph(familyGraph, hosted(FamilyRoute));
publicRoutes.registerGraph(familiesGraph, hosted(FamiliesRoute));
publicRoutes.registerGraph(schedulesGraph, hosted(SchedulesRoute));
publicRoutes.registerGraph(ductsGraph, hosted(DuctsRoute));
publicRoutes.registerGraph(parameterLinksGraph, hosted(ParameterLinksRoute));
publicRoutes.registerGraph(podsGraph, hosted(PodsRoute));
