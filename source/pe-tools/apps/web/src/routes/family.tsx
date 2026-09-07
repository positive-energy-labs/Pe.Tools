import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";

import { createFixtureFamilyStore, familyFixtures, type FamilyFixtureName } from "#/family/fixture";
import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { RouteScope } from "#/workbench/route-scope";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import type { Scope } from "#/state/route-store";

export const familySearch = (
  search: Record<string, unknown>,
): { thread?: string; source?: "fixture"; fixture?: FamilyFixtureName; capture?: boolean } => ({
  capture: search.capture === true || search.capture === "true" ? true : undefined,
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  source: search.source === "fixture" ? "fixture" : undefined,
  fixture:
    search.source === "fixture" &&
    typeof search.fixture === "string" &&
    Object.hasOwn(familyFixtures, search.fixture)
      ? (search.fixture as FamilyFixtureName)
      : undefined,
});

export const Route = createFileRoute("/family")({
  validateSearch: familySearch,
  component: FamilyRoute,
});

function FamilyRoute() {
  return <FamilyRouteContent {...Route.useSearch()} />;
}

export function FamilyRouteContent({
  source,
  fixture,
  capture,
}: {
  source?: "fixture";
  fixture?: FamilyFixtureName;
  capture?: boolean;
}) {
  if (source === "fixture") return <FamilyFixtureRoute key={fixture} fixture={fixture} />;
  return (
    <RouteScope>
      {(scope) => <FamilyStoreOwner key={scope.scope.document} scope={scope} capture={capture} />}
    </RouteScope>
  );
}

function FamilyFixtureRoute({ fixture }: { fixture?: FamilyFixtureName }) {
  const store = useRouteStore(() => createFixtureFamilyStore(appAtomRegistry, fixture));
  return <FamilyWorkspace store={store} source="fixture" />;
}

function FamilyStoreOwner({ scope, capture }: { scope: Scope; capture?: boolean }) {
  const store = useRouteStore(() => {
    return createFamilyStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamilyHost(),
    });
  });
  const ready = useAtomValue(store.atoms.ready) != null;
  useEffect(() => {
    if (capture && ready) void store.actions.capture().catch(() => undefined);
  }, [capture, ready, store]);
  return <FamilyWorkspace store={store} />;
}
