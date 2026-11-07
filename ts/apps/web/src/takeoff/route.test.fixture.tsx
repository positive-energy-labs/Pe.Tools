import { mountRoute, type MountRouteProps } from "#/shell/legacy-mount";
import { takeoffGraph } from "./graph";
import { takeoffAdaptersFor } from "./graph-route";

const TakeoffMount = mountRoute(takeoffGraph, takeoffAdaptersFor(takeoffGraph));
export function TakeoffsRoute(props: MountRouteProps) {
  return <TakeoffMount {...props} />;
}
export function LiveTakeoffsRoute(props: MountRouteProps) {
  return <TakeoffMount {...props} />;
}
export { takeoffsRoute, takeoffAdapters } from "./graph-route";
