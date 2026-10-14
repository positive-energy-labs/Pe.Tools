import { lazy, useState } from "react";
import { createRouteRegistry, defineRoutePlugin } from "@pe/kit/route-registry";
import { manifest as families } from "#/families/manifest";
import { familyManifest } from "#/family/manifest";
import { openManifest } from "#/open/manifest";
import { manifest as parameterLinks } from "#/parameter-links/manifest";
import { manifest as rooms } from "#/rooms/manifest";
import { schedulesManifest } from "#/route/schedules/manifest";
import { manifest as pods } from "#/routes/pods";
import { manifest as takeoffs } from "#/takeoff/manifest";

const LiveScheduleGridWorkspace = lazy(() =>
  import("#/route/schedules/live").then((module) => ({
    default: module.LiveScheduleGridWorkspace,
  })),
);
const FamilyRouteView = lazy(() =>
  import("#/family/live").then((module) => ({ default: module.FamilyRouteView })),
);
const PodsRouteContent = lazy(() =>
  import("#/routes/pods").then((module) => ({ default: module.PodsRouteContent })),
);
const FamiliesRouteContent = lazy(() =>
  import("#/routes/families").then((module) => ({ default: module.FamiliesRouteContent })),
);
const ParameterLinksRouteContent = lazy(() =>
  import("#/routes/parameter-links").then((module) => ({
    default: module.ParameterLinksRouteContent,
  })),
);
const TakeoffsPane = lazy(() =>
  import("#/takeoff/pane").then((module) => ({ default: module.TakeoffsPane })),
);
const OpenPage = lazy(() =>
  import("#/open/route").then((module) => ({ default: module.OpenPage })),
);
const RoomsRoute = lazy(() =>
  import("#/rooms/route").then((module) => ({ default: module.RoomsRoute })),
);

export const publicRoutes = createRouteRegistry();
publicRoutes.register(defineRoutePlugin({ manifest: openManifest, hosted: () => <OpenPage /> }));
publicRoutes.register(
  defineRoutePlugin({
    manifest: takeoffs,
    hosted: ({ thread }) => <TakeoffsPane thread={thread} />,
  }),
);
publicRoutes.register(
  defineRoutePlugin({
    manifest: familyManifest(),
    hosted: ({ thread }) => <FamilyRouteView thread={thread} url={false} />,
  }),
);
publicRoutes.register(
  defineRoutePlugin({
    manifest: families,
    hosted: ({ thread, visible }) => (
      <FamiliesRouteContent thread={thread} visible={visible} surface="chat" />
    ),
  }),
);
publicRoutes.register(
  defineRoutePlugin({ manifest: pods, hosted: ({ thread }) => <HostedPods thread={thread} /> }),
);
publicRoutes.register(
  defineRoutePlugin({
    manifest: parameterLinks,
    hosted: ({ thread }) => <ParameterLinksRouteContent thread={thread} />,
  }),
);
publicRoutes.register(
  defineRoutePlugin({
    manifest: schedulesManifest(),
    hosted: ({ thread }) => <LiveScheduleGridWorkspace framed url={false} thread={thread} />,
  }),
);
publicRoutes.register(defineRoutePlugin({ manifest: rooms, hosted: () => <HostedRooms /> }));

function HostedRooms() {
  const [layers, setLayers] = useState("");
  return <RoomsRoute focus="" layers={layers} setLayers={setLayers} url={false} />;
}

function HostedPods({ thread }: { thread: string }) {
  const [ref, select] = useState<{ pod?: string; path?: string }>({});
  return <PodsRouteContent {...ref} thread={thread} select={select} />;
}
