import { registerRoute, registerTypedRoute } from "../shell/route-registration";
import { publicRoutes } from "./route-discovery";
import { builtinRouteKeys, builtinRouteStamp, loadBuiltinRoute, typedBuiltin } from "./builtin-inventory";
import { sessionsGraph } from "#/sessions/graph";
import { lazy, type ComponentType } from "react";
import { registerLegacyGraph } from "#/shell/legacy-route-door";
import { takeoffGraph } from "#/takeoff/graph";
import type { MountRouteProps } from "#/shell/mount";
import { workFingerprintSchema } from "@pe/agent-contracts";

/** A route body stays out of the shell chunk until a pane mounts it. */
const named = <K extends string, P>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) =>
  lazy(() => load().then((module) => ({ default: module[name] })));
const TakeoffsPane = named(() => import("#/takeoff/pane"), "TakeoffsPane");
export { publicRoutes };
export const publicRoutesReady = Promise.all(
  builtinRouteKeys.map(async (key) => {
    const typed=typedBuiltin(key);
    if (typed) {
      const fingerprint = workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp(key)}`);
      registerTypedRoute(typed, fingerprint);
      return;
    }
    const result = await loadBuiltinRoute(key, builtinRouteStamp(key));
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    registerRoute(result.route);
  }),
);
void publicRoutesReady.catch((error) => console.error("Builtin discovery refused", error));
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

const sessionsRoute = lazy(async () => ({
  default: (await import("#/sessions/route")).SessionsRoute,
}));
registerLegacyGraph(sessionsGraph, hosted(sessionsRoute));
