import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { RouteShell } from "#/route";
import { SettingsBody } from "#/machine/body";
import { readLink } from "@pe/agent-contracts";
import { settingsDestination } from "#/machine/model";
import { routeSearch } from "#/route/route-owner";
import { useMachine } from "#/machine/use-machine";
import { useDestination } from "#/navigation/state";
import { useSurfaceHost } from "#/navigation/surface-host";
import { settingsManifest as manifest } from "#/route/surface-manifests";

export const Route = createFileRoute("/settings")({
  validateSearch: (search: SearchSchemaInput & Record<string, unknown>) => ({
    ...routeSearch(search),
    ...readLink("settings", search).page,
  }),
  component: SettingsRoute,
});
function SettingsRoute() {
  const { section, session: named } = Route.useSearch();
  const session = named || undefined;
  const { reading, fixture } = useMachine();
  const host = useSurfaceHost();
  const go = useDestination();
  return (
    <RouteShell manifest={manifest}>
      <main
        data-surface="page"
        className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] px-3 py-2"
        aria-label="settings"
      >
        <div className="mx-auto w-full max-w-3xl">
          <SettingsBody
            reading={reading}
            fixture={fixture}
            shell={host.surface}
            group={section}
            session={session}
            onGroup={(next) =>
              go(settingsDestination(next, next === "revit" ? session : undefined))
            }
          />
        </div>
      </main>
    </RouteShell>
  );
}
