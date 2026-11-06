import { registerRoute } from "../shell/route-registration";
import { publicRoutes } from "./route-discovery";
import { builtinRouteKeys, builtinRouteStamp, loadBuiltinRoute } from "./builtin-inventory";
import { sessionsGraph } from "#/sessions/graph";
import { lazy, type ComponentType } from "react";
import { registerLegacyGraph } from "#/shell/legacy-route-door";
import { openGraph } from "#/open/graph";
import { podsGraph } from "#/pods/graph";
import { takeoffGraph } from "#/takeoff/graph";
import { roomsGraph } from "#/rooms/graph";
import { familyGraph } from "#/family/graph";
import { settingsGraph } from "#/settings/graph";
import { mountRoute, type MountRouteProps } from "#/shell/mount";

/** A route body stays out of the shell chunk until a pane mounts it. */
const named = <K extends string, P>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));
const PodsRoute = named(() => import("#/pods/route"), "PodsRoute");
const ChatRoute = named(() => import("#/chat/chat-shell"), "ChatShell");
const TakeoffsPane = named(() => import("#/takeoff/pane"), "TakeoffsPane");
const OpenPage = lazy(async () => ({
  default: mountRoute(openGraph, (await import("#/open/route")).openAdapters),
}));
const RoomsRoute = named(() => import("#/rooms/route"), "RoomsRoute");
const FamilyRoute = lazy(async () => ({
  default: mountRoute(familyGraph, (await import("#/family/route")).familyAdapters),
}));

const SettingsRoute = lazy(async () => ({
  default: mountRoute(settingsGraph, (await import("#/settings/route")).settingsAdapters),
}));
export { publicRoutes };
export const publicRoutesReady = Promise.all(
  builtinRouteKeys.map(async (key) => {
    const result = await loadBuiltinRoute(key, builtinRouteStamp(key));
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    if (key === "chat")
      publicRoutes.register({
        manifest: result.route.data,
        admitted: result.route,
        hosted: ({ target }) => <ChatRoute target={target} docked />,
      });
    else registerRoute(result.route);
  }),
);
void publicRoutesReady.catch((error) => console.error("Builtin discovery refused", error));
registerLegacyGraph(settingsGraph, hosted(SettingsRoute));
registerLegacyGraph(openGraph, hosted(OpenPage));
registerLegacyGraph(takeoffGraph, ({ visible, ...binding }) => (
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
registerLegacyGraph(roomsGraph, hosted(RoomsRoute));
registerLegacyGraph(familyGraph, hosted(FamilyRoute));
registerLegacyGraph(podsGraph, hosted(PodsRoute));

const sessionsRoute = lazy(async () => ({
  default: (await import("#/sessions/route")).SessionsRoute,
}));
registerLegacyGraph(sessionsGraph, hosted(sessionsRoute));
