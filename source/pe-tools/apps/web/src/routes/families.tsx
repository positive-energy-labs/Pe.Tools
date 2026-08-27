import { createFileRoute } from "@tanstack/react-router";

import { createLiveFamiliesHost } from "#/families/host";
import { createFamiliesStore } from "#/families/store";
import { FamiliesWorkspace } from "#/families/workspace";
import { RouteDocument } from "#/workbench/route-document";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";

export const Route = createFileRoute("/families")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { thread?: string } => ({
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  }),
  component: FamiliesRoute,
});

function FamiliesRoute() {
  return (
    <RouteDocument>{(at) => <FamiliesStoreOwner key={at} documentAddress={at} />}</RouteDocument>
  );
}

function FamiliesStoreOwner({ documentAddress }: { documentAddress: import("@pe/agent-contracts").Address }) {
  const store = useRouteStore(() => {
    const scope = { documentAddress };
    return createFamiliesStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamiliesHost(),
    });
  });
  return <FamiliesWorkspace store={store} />;
}
