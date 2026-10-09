import { createFileRoute } from "@tanstack/react-router";

import { RouteShell, emptyManifest } from "#/route";
import { AccessSwitch } from "#/chat/first-open";
import { useProviders } from "#/workbench/provider/providers";

const manifest = {
  ...emptyManifest("settings", "Settings"),
  docs: "UI settings, and whether Pea asks before each change. Providers, sign-in and endpoints live in the machine drawer behind the version chip, because harness readiness is machine state.",
};

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

function SettingsRoute() {
  const providers = useProviders("");
  return (
    <RouteShell manifest={manifest}>
      <div className="flex flex-col gap-4 p-6">
        <AccessSwitch providers={providers} />
        {providers.error ? (
          <p className="t-small" data-tone="caution">
            {providers.error}
          </p>
        ) : null}
      </div>
    </RouteShell>
  );
}
