import { createFileRoute } from "@tanstack/react-router";

import {
  createFixtureFamiliesStore,
  fixtureFamilyRows,
  nativeFixtureRows,
} from "#/families/fixture";
import { createLiveFamiliesHost } from "#/families/host";
import { createFamiliesStore } from "#/families/store";
import { FamiliesWorkspace } from "#/families/workspace";
import { RouteScope } from "#/workbench/route-scope";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import type { Scope } from "#/state/route-store";

export const familiesSearch = (
  search: Record<string, unknown>,
): { thread?: string; source?: "fixture"; fixture?: "native" } => ({
  ...(search.fixture === "native" ? { fixture: "native" as const } : {}),
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  source: search.source === "fixture" ? "fixture" : undefined,
});

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  component: FamiliesRoute,
});

function FamiliesRoute() {
  return <FamiliesRouteContent {...Route.useSearch()} />;
}

export function FamiliesRouteContent({
  source,
  fixture,
}: {
  source?: "fixture";
  fixture?: "native";
}) {
  if (source === "fixture")
    return <FamiliesFixtureRoute key={fixture} native={fixture === "native"} />;
  return (
    <RouteScope>
      {(scope) => <FamiliesStoreOwner key={scope.scope.document} scope={scope} />}
    </RouteScope>
  );
}

export function FamiliesFixtureRoute({ native = false }: { native?: boolean }) {
  const store = useRouteStore(() => createFixtureFamiliesStore(appAtomRegistry, native));
  return (
    <FamiliesWorkspace
      store={store}
      fixtureFamilies={native ? nativeFixtureRows : fixtureFamilyRows}
    />
  );
}

function FamiliesStoreOwner({ scope }: { scope: Scope }) {
  const store = useRouteStore(() => {
    return createFamiliesStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamiliesHost(),
    });
  });
  return <FamiliesWorkspace store={store} />;
}
