import { createFileRoute } from "@tanstack/react-router";

import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { RouteDocumentEmpty, useRouteDocumentAddress } from "#/workbench/route-document";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";

export const Route = createFileRoute("/family")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    thread?: string;
    source?: string;
  } => ({
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
  }),
  component: FamilyRoute,
});

function FamilyRoute() {
  const documentAddress = useRouteDocumentAddress();
  if (!documentAddress) return <RouteDocumentEmpty />;
  return (
    <FamilyStoreOwner
      key={documentAddress}
      documentAddress={documentAddress}
    />
  );
}

function FamilyStoreOwner({
  documentAddress,
}: {
  documentAddress: import("@pe/agent-contracts").Address;
}) {
  const store = useRouteStore(() => {
    const scope = { documentAddress };
    return createFamilyStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamilyHost(scope),
    });
  });
  return <FamilyWorkspace store={store} />;
}
