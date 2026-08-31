import { createFileRoute } from "@tanstack/react-router";

import { createFixtureFamilyStore } from "#/family/fixture";
import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { RouteDocument } from "#/workbench/route-document";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";

export const familySearch = (
  search: Record<string, unknown>,
): { thread?: string; source?: "fixture" } => ({
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  source: search.source === "fixture" ? "fixture" : undefined,
});

export const Route = createFileRoute("/family")({
  validateSearch: familySearch,
  component: FamilyRoute,
});

function FamilyRoute() {
  return <FamilyRouteContent source={Route.useSearch().source} />;
}

export function FamilyRouteContent({ source }: { source?: "fixture" }) {
  if (source === "fixture") return <FamilyFixtureRoute />;
  return (
    <RouteDocument>{(at) => <FamilyStoreOwner key={at} documentAddress={at} />}</RouteDocument>
  );
}

function FamilyFixtureRoute() {
  const store = useRouteStore(() => createFixtureFamilyStore(appAtomRegistry));
  return <FamilyWorkspace store={store} fixture />;
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
