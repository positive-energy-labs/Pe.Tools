import { createFileRoute } from "@tanstack/react-router";

import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { RouteDocument } from "#/workbench/route-document";
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
  return (
    <RouteDocument>{(at) => <FamilyStoreOwner key={at} documentAddress={at} />}</RouteDocument>
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
      host: createLiveFamilyHost(),
    });
  });
  return <FamilyWorkspace store={store} />;
}
