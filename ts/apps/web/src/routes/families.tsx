import { createFileRoute } from "@tanstack/react-router";

import { FamiliesWorkspace } from "#/families/workspace";
import { useFamiliesStore } from "#/families/store";
import { manifest } from "#/families/manifest";
import { urlPage, useRouteThread } from "#/route";
import { routeSearch } from "#/route/route-owner";

const str = (value: unknown) => (typeof value === "string" ? value : "");
const url = urlPage(manifest)!;

/** `?demo=<action>` mounts one seed of `manifest.seeds`; the Page's url keys (`query` among them) are the manifest's. */
export const familiesSearch = (search: Record<string, unknown>) => ({
  ...routeSearch(search),
  ...url.read(search),
  demo: str(search.demo) || undefined,
});

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  search: { middlewares: [...url.middlewares] },
  component: FamiliesRoute,
});

function FamiliesRoute() {
  const { target } = Route.useSearch();
  const thread = useRouteThread();
  return <FamiliesRouteContent target={target} thread={thread} surface="route" url />;
}

export function FamiliesRouteContent({
  target = "",
  thread,
  url = false,
  visible = true,
  surface = "route",
}: {
  target?: string;
  thread?: string;
  /** True only on the route itself; a chat pane does not own the URL. */
  url?: boolean;
  visible?: boolean;
  surface?: "chat" | "route";
}) {
  const store = useFamiliesStore({ target, thread, url });
  return (
    <FamiliesWorkspace
      store={store}
      url={url}
      thread={thread}
      visible={visible}
      surface={surface}
    />
  );
}
