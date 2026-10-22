import { createFileRoute } from "@tanstack/react-router";
import { RouteShell, routeFile, useAddressPage, useRouteLease } from "#/route";
import { SettingsBody } from "#/machine/body";
import { useMachine } from "#/machine/use-machine";
import { useSurfaceHost } from "#/navigation/surface-host";
import { settingsManifest as manifest } from "#/route/surface-manifests";

export const Route = createFileRoute("/settings")({
  ...routeFile("settings"),
  component: SettingsRoute,
});

function SettingsRoute() {
  const page = useAddressPage("settings");
  const [{ section, session: named }, setPage] = page;
  const session = named || undefined;
  const { reading, fixture } = useMachine();
  const host = useSurfaceHost();
  useRouteLease("settings", page, {
    facts: { machine: reading.state, shell: host.surface },
  });
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
            group={section === "none" ? null : section}
            session={session}
            onGroup={(next) =>
              setPage({ section: next ?? "none", session: next === "revit" ? (session ?? "") : "" })
            }
          />
        </div>
      </main>
    </RouteShell>
  );
}
