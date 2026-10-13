import { createFileRoute } from "@tanstack/react-router";
import { RouteShell } from "#/route";
import { machineManifest } from "#/machine/manifest";
import { MachinePage } from "#/machine/page";
import { useMachine } from "#/machine/use-machine";
import type { GroupKey } from "#/machine/model";
import { useDestination } from "#/navigation/state";
import { useSurfaceHost } from "#/navigation/surface-host";

const SECTIONS: readonly GroupKey[] = ["revit", "update", "share", "pea", "host"];
export function machineSearch(search: Record<string, unknown>): {
  section?: GroupKey;
  session?: string;
} {
  return {
    section:
      typeof search.section === "string" && SECTIONS.includes(search.section as GroupKey)
        ? (search.section as GroupKey)
        : undefined,
    session:
      typeof search.session === "string" && search.session.trim() ? search.session : undefined,
  };
}
export const Route = createFileRoute("/machine")({
  validateSearch: machineSearch,
  component: MachineRoute,
});
function MachineRoute() {
  const { section, session } = Route.useSearch();
  const { reading, fixture } = useMachine();
  const host = useSurfaceHost();
  const go = useDestination();
  return (
    <RouteShell manifest={machineManifest}>
      <MachinePage
        reading={reading}
        fixture={fixture}
        shell={host.surface}
        section={section}
        session={session}
        onSection={(next) => {
          const query = new URLSearchParams();
          if (next) query.set("section", next);
          if (session && next === "revit") query.set("session", session);
          go(`/machine${query.size ? `?${query}` : ""}`);
        }}
      />
    </RouteShell>
  );
}
