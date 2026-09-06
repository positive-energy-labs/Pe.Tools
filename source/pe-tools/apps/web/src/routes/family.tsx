import { createFileRoute } from "@tanstack/react-router";

import { createFixtureFamilyStore } from "#/family/fixture";
import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { RouteScope } from "#/workbench/route-scope";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import type { Scope } from "#/state/route-store";

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
    <RouteScope>
      {(scope) => <FamilyStoreOwner key={scope.scope.document} scope={scope} />}
    </RouteScope>
  );
}

function FamilyFixtureRoute() {
  const store = useRouteStore(() => createFixtureFamilyStore(appAtomRegistry));
  return <FamilyWorkspace store={store} source="fixture" />;
}

function FamilyStoreOwner({ scope }: { scope: Scope }) {
  const store = useRouteStore(() => {
    return createFamilyStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamilyHost(),
    });
  });
  return <FamilyWorkspace store={store} />;
}
