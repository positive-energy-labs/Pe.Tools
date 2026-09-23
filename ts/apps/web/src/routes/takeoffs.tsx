import { createFileRoute } from "@tanstack/react-router";
import { TakeoffsRoute } from "#/takeoff/route";
import { routeSearch } from "#/route/route-owner";

export { TakeoffsRoute, LiveTakeoffsRoute } from "#/takeoff/route";
import { manifest as takeoffsManifest } from "#/takeoff/manifest";
export const manifest = takeoffsManifest;

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const Route = createFileRoute("/takeoffs")({
  /**
   * `?source=fixture|saved|live` is gone. `?demo=<action>` mounts one seed of `manifest.seeds`
   * in an isolated owner; `?work=<capture>` names a saved capture. Level, zone and room are the
   * standalone view's shareable navigation state.
   */
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    demo: str(search.demo) || undefined,
    level: str(search.level) || undefined,
    zone: str(search.zone) || undefined,
    room: str(search.room) || undefined,
  }),
  component: TakeoffsFileRoute,
});

function TakeoffsFileRoute() {
  const { target, work, level, zone, room } = Route.useSearch();
  return <TakeoffsRoute target={target} work={work} level={level} zone={zone} room={room} />;
}
