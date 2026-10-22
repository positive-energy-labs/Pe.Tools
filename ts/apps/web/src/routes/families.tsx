import { useRouteSearch } from "#/route/activity";
import { createFileRoute } from "@tanstack/react-router";

import { FamiliesWorkspace } from "#/families/workspace";
import { useFamiliesStore } from "#/families/store";
import { manifest } from "#/families/manifest";
import { urlPage, useRouteThread } from "#/route";
import { routeSearch } from "#/route/route-owner";

const url = urlPage(manifest)!;

/** The contract's `families` fields (`query`, `demo` among them), with the root carry. */
export const familiesSearch = (search: Record<string, unknown>) => ({
  ...routeSearch(search),
  ...url.read(search),
});

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  search: { middlewares: [...url.middlewares] },
  component: FamiliesRoute,
});

function FamiliesRoute() {
  const { target } = useRouteSearch("families");
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
