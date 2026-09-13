import { createFileRoute } from "@tanstack/react-router";
import { TakeoffsRoute } from "#/takeoff/route";
import { routeSearch } from "#/route";

export { takeoffsWorkingCopyPath, TakeoffsRoute, LiveTakeoffsRoute } from "#/takeoff/route";
import { manifest as takeoffsManifest } from "#/takeoff/manifest";
export const manifest = takeoffsManifest;

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const Route = createFileRoute("/takeoffs")({
  /**
   * `?source=fixture|saved|live` is gone. `?demo=<action>` mounts one seed of `manifest.seeds`
   * in an isolated owner; `?work=<capture>` names a saved capture as the Work this route reads.
   */
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    demo: str(search.demo) || undefined,
    thread: str(search.thread) || undefined,
  }),
  component: TakeoffsFileRoute,
});

function TakeoffsFileRoute() {
  const { target, work } = Route.useSearch();
  return <TakeoffsRoute target={target} work={work} />;
}
