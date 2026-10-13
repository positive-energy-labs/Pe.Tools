import { createFileRoute } from "@tanstack/react-router";

import { RouteShell, emptyManifest } from "#/route";
import { ProviderSetup } from "#/machine/pea";
import { AccessSwitch } from "#/chat/first-open";
import { useProviders } from "#/workbench/provider/providers";

const manifest = {
  ...emptyManifest("settings", "Settings"),
  docs: "UI settings, agent approvals, and the machine-owned provider setup.",
};

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const providers = useProviders("");
  return (
    <RouteShell manifest={manifest}>
      <div className="flex flex-col gap-4 p-6">
        <ProviderSetup providers={providers} />
        <AccessSwitch providers={providers} />
      </div>
    </RouteShell>
  );
}
