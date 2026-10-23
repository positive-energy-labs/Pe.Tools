import { useRouteSearchSlice } from "#/route/activity";
import { createFileRoute } from "@tanstack/react-router";
import { TakeoffsRoute } from "#/takeoff/route";
import { urlPage } from "#/route";
import { manifest } from "#/takeoff/manifest";
import { routeSearch } from "#/route/route-owner";

export { TakeoffsRoute, LiveTakeoffsRoute } from "#/takeoff/route";

const url = urlPage(manifest)!;

export const Route = createFileRoute("/takeoffs")({
  /**
   * `?source=fixture|saved|live` is gone. `?demo=<action>` mounts one seed of `manifest.seeds`
   * in an isolated owner; `?work=<capture>` names a saved capture. Level, zone and room are the
   * standalone view's shareable navigation state.
   */
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...url.read(search),
  }),
  search: { middlewares: [...url.middlewares] },
  component: TakeoffsFileRoute,
});

function TakeoffsFileRoute() {
  const { target, work } = useRouteSearchSlice(({ target, work }) => ({ target, work }));
  return <TakeoffsRoute target={target} work={work} />;
}
