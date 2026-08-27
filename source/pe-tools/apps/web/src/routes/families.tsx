import { createFileRoute } from "@tanstack/react-router";

import { createLiveFamiliesHost } from "#/families/host";
import { createFamiliesStore } from "#/families/store";
import { FamiliesWorkspace } from "#/families/workspace";
import {
  RouteDocumentEmpty,
  RouteDocumentSurface,
  useRouteDocumentAddress,
} from "#/workbench/route-document";
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
  const documentAddress = useRouteDocumentAddress();
  if (!documentAddress) return <RouteDocumentEmpty />;
  return (
    <RouteDocumentSurface at={documentAddress}>
      <FamiliesStoreOwner key={documentAddress} documentAddress={documentAddress} />
    </RouteDocumentSurface>
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
