import { routeFromGraph, type RouteAdapters, type MountBody } from "#/shell/mount";
import { RegisteredRouteSettings } from "#/shell/settings-registry";
import { SettingsBody } from "#/machine/body";
import type { Machine, Reading } from "@pe/agent-contracts";
import { settingsSources, type SettingsMachine } from "./sources";
import { useSurfaceHost } from "#/navigation/surface-host";
import { settingsGraph, type SettingsPage } from "./graph";

function SettingsPane({
  page: { section, session: named },
  owner,
}: MountBody<SettingsPage, unknown>) {
  const session = named || undefined;
  const state = owner.readings.get("machine");
  const seen = (state.value ?? state.previous) as SettingsMachine | undefined;
  const previous =
    seen?.reading.state === "ready"
      ? seen.reading.observation
      : seen?.reading.state !== "absent"
        ? seen?.reading.previous
        : undefined;
  const reading: Reading<Machine> =
    state.current && seen
      ? seen.reading
      : state.status === "failed"
        ? { state: "failed", message: state.error ?? "Machine read failed", previous }
        : previous
          ? { state: "stale", reason: "disconnected", previous }
          : { state: "absent" };
  const fixture = seen?.fixture ?? false;
  const host = useSurfaceHost();
  return (
    <main
      data-surface="page"
      className="h-full w-full min-w-0 overflow-x-hidden overflow-y-auto px-3 py-2"
      aria-label="settings"
    >
      <div className="mx-auto w-full max-w-3xl">
        <SettingsBody
          reading={reading}
          fixture={fixture}
          shell={host.surface}
          group={section === "none" ? null : section}
          session={session}
          onGroup={(next) => void owner.control("open-section", { section: next ?? "none" }).run()}
        />
        <RegisteredRouteSettings />
      </div>
    </main>
  );
}
export const settingsAdapters: RouteAdapters<SettingsPage, unknown> = {
  sources: settingsSources,
  bodies: { settings: (body) => <SettingsPane {...body} /> },
  binding: (_id, row) => ({ subject: null, args: row }),
};
export const settingsRoute = routeFromGraph(settingsGraph, settingsAdapters, "/settings");
