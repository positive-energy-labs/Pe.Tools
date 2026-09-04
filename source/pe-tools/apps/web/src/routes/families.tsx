import { createFileRoute } from "@tanstack/react-router";

import { createFixtureFamiliesStore, fixtureFamilyRows } from "#/families/fixture";
import { createLiveFamiliesHost } from "#/families/host";
import { createFamiliesStore } from "#/families/store";
import { FamiliesWorkspace } from "#/families/workspace";
import { RouteDocument } from "#/workbench/route-document";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { pageScope } from "#/state/route-store";

export const familiesSearch = (
  search: Record<string, unknown>,
): { thread?: string; source?: "fixture" } => ({
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  source: search.source === "fixture" ? "fixture" : undefined,
});

export const Route = createFileRoute("/families")({
  validateSearch: familiesSearch,
  component: FamiliesRoute,
});

function FamiliesRoute() {
  return <FamiliesRouteContent source={Route.useSearch().source} />;
}

export function FamiliesRouteContent({ source }: { source?: "fixture" }) {
  if (source === "fixture") return <FamiliesFixtureRoute />;
  return (
    <RouteDocument>{(at) => <FamiliesStoreOwner key={at} documentAddress={at} />}</RouteDocument>
  );
}

export function FamiliesFixtureRoute() {
  const store = useRouteStore(() => createFixtureFamiliesStore(appAtomRegistry));
  return <FamiliesWorkspace store={store} fixtureFamilies={fixtureFamilyRows} />;
}

function FamiliesStoreOwner({
  documentAddress,
}: {
  documentAddress: import("@pe/agent-contracts").Address;
}) {
  const store = useRouteStore(() => {
    const scope = pageScope(documentAddress);
    return createFamiliesStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamiliesHost(),
    });
  });
  return <FamiliesWorkspace store={store} />;
}
