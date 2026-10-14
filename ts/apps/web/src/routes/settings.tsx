import { createFileRoute } from "@tanstack/react-router";
import { appRouteByKey } from "@pe/agent-contracts";
import { RouteShell, urlPage } from "#/route";
import { SettingsProjection } from "#/settings/options";
import { SettingsActions } from "#/settings/options-actions";
import { readGlobalOptions } from "#/settings/option-catalogue";
// Registers this owner's durable forms for a direct /settings deep link, without its Page.
import "#/machine/manifest";

import { settingsManifest as manifest } from "#/route/surface-manifests";
const url = urlPage(manifest)!;
export const settingsSearch = (
  search: Record<string, unknown>,
): { subject?: string; section?: string } => {
  search = url.read(search);
  const subject =
    typeof search.subject === "string" ? appRouteByKey(search.subject)?.key : undefined;
  const section =
    typeof search.section === "string" &&
    readGlobalOptions().some(
      (owner) =>
        owner.route === subject && owner.panels.some((panel) => panel.id === search.section),
    )
      ? search.section
      : undefined;
  return { subject, section };
};
export const Route = createFileRoute("/settings")({
  validateSearch: settingsSearch,
  search: { middlewares: [...url.middlewares] },
  component: SettingsRoute,
});
function SettingsRoute() {
  const { subject, section } = Route.useSearch();
  return (
    <RouteShell manifest={manifest}>
      <div className="flex flex-col gap-4 p-6">
        <SettingsProjection subject={subject} section={section} />
        {!section && <SettingsActions />}
      </div>
    </RouteShell>
  );
}
