import { lazy, useState, type ComponentType } from "react";
import { createRouteRegistry } from "@pe/kit/route-registry";
import { manifest as families } from "#/families/manifest";
import { familyManifest } from "#/family/manifest";
import { openManifest } from "#/open/manifest";
import { manifest as parameterLinks } from "#/parameter-links/manifest";
import { manifest as rooms } from "#/rooms/manifest";
import { schedulesManifest } from "#/route/schedules/manifest";
import { manifest as pods } from "#/routes/pods";
import { manifest as takeoffs } from "#/takeoff/manifest";

/** A route body stays out of the shell chunk until a pane mounts it. */
const named = <K extends string, P>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));
const LiveScheduleGridWorkspace = named(
  () => import("#/route/schedules/live"),
  "LiveScheduleGridWorkspace",
);
const FamilyRouteView = named(() => import("#/family/live"), "FamilyRouteView");
const PodsRouteContent = named(() => import("#/routes/pods"), "PodsRouteContent");
const FamiliesRouteContent = named(() => import("#/routes/families"), "FamiliesRouteContent");
const ParameterLinksRouteContent = named(
  () => import("#/routes/parameter-links"),
  "ParameterLinksRouteContent",
);
const TakeoffsPane = named(() => import("#/takeoff/pane"), "TakeoffsPane");
const OpenPage = named(() => import("#/open/route"), "OpenPage");
const RoomsRoute = named(() => import("#/rooms/route"), "RoomsRoute");

export const publicRoutes = createRouteRegistry();
publicRoutes.register({ manifest: openManifest, hosted: () => <OpenPage /> });
publicRoutes.register({
  manifest: takeoffs,
  hosted: ({ thread }) => <TakeoffsPane thread={thread} />,
});
publicRoutes.register({
  manifest: familyManifest(),
  hosted: ({ thread }) => <FamilyRouteView thread={thread} url={false} />,
});
publicRoutes.register({
  manifest: families,
  hosted: ({ thread, visible }) => (
    <FamiliesRouteContent thread={thread} visible={visible} surface="chat" />
  ),
});
publicRoutes.register({ manifest: pods, hosted: ({ thread }) => <HostedPods thread={thread} /> });
publicRoutes.register({
  manifest: parameterLinks,
  hosted: ({ thread }) => <ParameterLinksRouteContent thread={thread} />,
});
publicRoutes.register({
  manifest: schedulesManifest(),
  hosted: ({ thread }) => <LiveScheduleGridWorkspace framed url={false} thread={thread} />,
});
publicRoutes.register({ manifest: rooms, hosted: () => <HostedRooms /> });

function HostedRooms() {
  const [layers, setLayers] = useState("");
  return <RoomsRoute focus="" layers={layers} setLayers={setLayers} url={false} />;
}

function HostedPods({ thread }: { thread: string }) {
  const [ref, select] = useState<{ pod?: string; path?: string }>({});
  return <PodsRouteContent {...ref} thread={thread} select={select} />;
}
