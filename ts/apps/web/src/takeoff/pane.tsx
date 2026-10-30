import { mountRoute, type MountRouteProps } from "#/shell/mount";
import { takeoffGraph } from "./graph";
import { takeoffAdapters } from "./graph-route";

const TakeoffMount = mountRoute(takeoffGraph, takeoffAdapters);
/** A hosted route keeps Page local and uses the same graph and Work door as standalone. */
export function TakeoffsPane(props: MountRouteProps) {
  return <TakeoffMount {...props} url={false} />;
}
