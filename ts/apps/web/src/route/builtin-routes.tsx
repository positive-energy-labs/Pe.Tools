import { scheduleSpecsGraph } from "#/schedule-specs/graph";
import { rhvacSyncGraph } from "#/rhvac-sync/graph";
import { zoneAuditGraph } from "#/zone-audit/graph";
import { sessionsGraph } from "#/sessions/graph";
import { podAdminGraph } from "#/pod-admin/graph";
import { lazy, type ComponentType } from "react";
import { legacyRouteDiscovery, registerLegacyGraph } from "#/shell/legacy-route-door";
import { openGraph } from "#/open/graph";
import { parameterLinksGraph } from "#/parameter-links/graph";
import { podsGraph } from "#/pods/graph";
import { takeoffGraph } from "#/takeoff/graph";
import { roomsGraph } from "#/rooms/graph";
import { familyGraph } from "#/family/graph";
import { familiesGraph } from "#/families/graph";
import { schedulesGraph } from "#/schedules/graph";
import { settingsGraph } from "#/settings/graph";
import { fansGraph } from "#/fans/graph";
import { ductsGraph } from "#/ducts/graph";
import { dataTablesGraph } from "#/data-tables/graph";
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
const DataTablesRoute = lazy(async () => ({
  default: mountRoute(dataTablesGraph, (await import("#/data-tables/route")).dataTablesAdapters),
}));

const SettingsRoute = lazy(async () => ({
  default: mountRoute(settingsGraph, (await import("#/settings/route")).settingsAdapters),
}));
// TODO: S1d combine admitted kernel discovery after the first route migrates.
export const publicRoutes = legacyRouteDiscovery;
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
registerLegacyGraph(familiesGraph, hosted(FamiliesRoute));
registerLegacyGraph(schedulesGraph, hosted(SchedulesRoute));
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

const scheduleSpecsRoute = lazy(async () => ({
  default: (await import("#/schedule-specs/route")).Body,
}));
registerLegacyGraph(scheduleSpecsGraph, hosted(scheduleSpecsRoute));

const FansRoute = lazy(async () => ({
  default: mountRoute(fansGraph, (await import("#/ducts/route")).ductsAdapters),
}));
registerLegacyGraph(fansGraph, hosted(FansRoute));
