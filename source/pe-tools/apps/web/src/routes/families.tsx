import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { createLiveFamiliesHost } from "#/families/host";
import { createFamiliesStore } from "#/families/store";
import { FamiliesWorkspace } from "#/families/workspace";
import { ThreadEmpty } from "#/components/thread-palette";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";

export const Route = createFileRoute("/families")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { target?: string; thread?: string } => ({
    target: typeof search.target === "string" ? search.target.trim() : "",
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  }),
  component: FamiliesRoute,
});

function FamiliesRoute() {
  const { target = "", thread } = Route.useSearch();
  if (!thread) return <ThreadEmpty />;
  return <FamiliesStoreOwner key={`${thread}:${target}`} thread={thread} target={target} />;
}

function FamiliesStoreOwner({ thread, target }: { thread: string; target: string }) {
  const navigate = useNavigate({ from: "/families" });
  const store = useRouteStore(() => {
    const scope = { threadId: thread };
    return createFamiliesStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamiliesHost(scope),
      search: {
        target,
        patch: (patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }) }),
      },
    });
  });
  return <FamiliesWorkspace store={store} />;
}
