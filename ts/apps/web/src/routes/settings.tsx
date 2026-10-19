import { createFileRoute } from "@tanstack/react-router";
import { RouteShell } from "#/route";
import { SettingsBody } from "#/machine/body";
import { GROUP_KEYS, settingsDestination, type GroupKey } from "#/machine/model";
import { useMachine } from "#/machine/use-machine";
import { useDestination } from "#/navigation/state";
import { useSurfaceHost } from "#/navigation/surface-host";
import { settingsManifest as manifest } from "#/route/surface-manifests";

export function settingsSearch(search: Record<string, unknown>): {
  section?: GroupKey;
  session?: string;
} {
  return {
    section:
      typeof search.section === "string" && GROUP_KEYS.includes(search.section as GroupKey)
        ? (search.section as GroupKey)
        : undefined,
    session:
      typeof search.session === "string" && search.session.trim() ? search.session : undefined,
  };
}
export const Route = createFileRoute("/settings")({
  validateSearch: settingsSearch,
  component: SettingsRoute,
});
function SettingsRoute() {
  const { section, session } = Route.useSearch();
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
