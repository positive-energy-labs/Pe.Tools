import { mountRoute, type MountRouteProps } from "#/shell/mount";
import { takeoffGraph } from "./graph";
import { takeoffAdapters } from "./graph-route";

const TakeoffMount = mountRoute(takeoffGraph, takeoffAdapters);
export function TakeoffsRoute(props: MountRouteProps) {
  return <TakeoffMount {...props} />;
}
export function LiveTakeoffsRoute(props: MountRouteProps) {
  return <TakeoffMount {...props} />;
}
export { takeoffsRoute, takeoffAdapters } from "./graph-route";
