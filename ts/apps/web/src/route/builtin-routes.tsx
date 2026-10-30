import { lazy, type ComponentType } from "react";
import { createRouteRegistry } from "@pe/kit/route-registry";
import { openManifest } from "#/open/manifest";
import { manifest as parameterLinks } from "#/parameter-links/manifest";
import { manifest as pods } from "#/routes/pods";
import { takeoffGraph } from "#/takeoff/graph";
import { roomsGraph } from "#/rooms/graph";
import { familyGraph } from "#/family/graph";
import { familiesGraph } from "#/families/graph";
import { schedulesGraph } from "#/schedules/graph";
import { ductsGraph } from "#/ducts/graph";
import { mountRoute, type MountRouteProps } from "#/shell/mount";

/** A route body stays out of the shell chunk until a pane mounts it. */
const named = <K extends string, P>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));
const PodsRouteContent = named(() => import("#/routes/pods"), "PodsRouteContent");
const ParameterLinksRouteContent = named(
  () => import("#/routes/parameter-links"),
  "ParameterLinksRouteContent",
);
const TakeoffsPane = named(() => import("#/takeoff/pane"), "TakeoffsPane");
const OpenPage = named(() => import("#/open/route"), "OpenPage");
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

export const publicRoutes = createRouteRegistry();
publicRoutes.register({ manifest: openManifest, hosted: () => <OpenPage /> });
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
publicRoutes.register({
  manifest: pods,
  hosted: ({ thread, visible }) => <HostedPods thread={thread} visible={visible} />,
});
publicRoutes.register({
  manifest: parameterLinks,
  hosted: ({ thread }) => <ParameterLinksRouteContent thread={thread} />,
});
/** A chat pane owns its Page without the address (`url={false}`), like Ducts. */
function HostedPods({ thread, visible }: { thread: string; visible: boolean }) {
  return <PodsRouteContent thread={thread} url={false} visible={visible} />;
}
