import { createRouteDiscovery, admittedWork, type DiscoveredRoute } from "./route-discovery";
import { builtinRouteKeys, builtinRouteStamp, loadBuiltinRoute } from "./builtin-inventory";
import { rhvacSyncGraph } from "#/rhvac-sync/graph";
import { zoneAuditGraph } from "#/zone-audit/graph";
import { sessionsGraph } from "#/sessions/graph";
import { podAdminGraph } from "#/pod-admin/graph";
import { lazy, type ComponentType } from "react";
import { registerLegacyGraph } from "#/shell/legacy-route-door";
import { openGraph } from "#/open/graph";
import { parameterLinksGraph } from "#/parameter-links/graph";
import { podsGraph } from "#/pods/graph";
import { takeoffGraph } from "#/takeoff/graph";
import { roomsGraph } from "#/rooms/graph";
import { familyGraph } from "#/family/graph";
import { settingsGraph } from "#/settings/graph";
import { fansGraph } from "#/fans/graph";
import { ductsGraph } from "#/ducts/graph";
import { dataTablesGraph } from "#/data-tables/graph";
import { mountRoute, type MountRouteProps } from "#/shell/mount";

/** A route body stays out of the shell chunk until a pane mounts it. */
const named = <K extends string, P>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));
const HostedAdmittedRoute = lazy(() =>
  import("../workbench/hosted-route").then((module) => ({ default: module.HostedAdmittedRoute })),
);
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

const DuctsRoute = lazy(async () => ({
  default: mountRoute(ductsGraph, (await import("#/ducts/route")).ductsAdapters),
}));
const DataTablesRoute = lazy(async () => ({
  default: mountRoute(dataTablesGraph, (await import("#/data-tables/route")).dataTablesAdapters),
}));

const SettingsRoute = lazy(async () => ({
  default: mountRoute(settingsGraph, (await import("#/settings/route")).settingsAdapters),
}));
const admitted = new Map<string, DiscoveredRoute>();
export const publicRoutes = createRouteDiscovery(() => [...admitted.values()]);
export const publicRoutesReady = Promise.all(
  builtinRouteKeys.map(async (key) => {
    const result = await loadBuiltinRoute(key, builtinRouteStamp(key));
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    const route = result.route;
    admitted.set(key, {
      manifest: route.data,
      admitted: route,
      work: admittedWork(route),
      hosted: (props) => <HostedAdmittedRoute route={route} {...props} />,
    });
    publicRoutes.changed();
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
registerLegacyGraph(ductsGraph, hosted(DuctsRoute));
registerLegacyGraph(parameterLinksGraph, hosted(ParameterLinksRoute));
registerLegacyGraph(podsGraph, hosted(PodsRoute));
registerLegacyGraph(dataTablesGraph, hosted(DataTablesRoute));

const PodAdminRoute = named(() => import("#/pod-admin/route"), "PodAdminRoute");
registerLegacyGraph(podAdminGraph, hosted(PodAdminRoute));

const sessionsRoute = lazy(async () => ({
  default: (await import("#/sessions/route")).SessionsRoute,
}));
registerLegacyGraph(sessionsGraph, hosted(sessionsRoute));

const zoneAuditRoute = lazy(async () => ({ default: (await import("#/zone-audit/route")).Body }));
registerLegacyGraph(zoneAuditGraph, hosted(zoneAuditRoute));

const rhvacSyncRoute = lazy(async () => ({ default: (await import("#/rhvac-sync/route")).Body }));
registerLegacyGraph(rhvacSyncGraph, hosted(rhvacSyncRoute));

const FansRoute = lazy(async () => ({
  default: mountRoute(fansGraph, (await import("#/ducts/route")).ductsAdapters),
}));
registerLegacyGraph(fansGraph, hosted(FansRoute));
