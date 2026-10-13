import type { SettingsPanel } from "#/settings/option-state";
import { AccessSwitch } from "#/chat/first-open";
import { useProviders } from "#/workbench/provider/providers";
import { ProviderSetup } from "./pea";
import { ShareSettings } from "./share";
import { StartupSettings } from "./startup";
import { machineOf } from "./model";
import { useMachine } from "./use-machine";

function ProviderPanel() {
  const { reading, fixture } = useMachine();
  const providers = useProviders("", !fixture, machineOf(reading) ?? undefined);
  return (
    <div className="flex flex-col gap-4">
      <ProviderSetup providers={providers} />
      <AccessSwitch providers={providers} />
    </div>
  );
}
function SharingPanel() {
  const { reading, fixture } = useMachine();
  const machine = machineOf(reading);
  return machine ? (
    <ShareSettings machine={machine} fixture={fixture} stale={reading.state !== "ready"} />
  ) : (
    <p className="text-ink-mute">Sharing settings wait for the machine reading.</p>
  );
}
function StartupPanel() {
  const { reading, fixture } = useMachine();
  return <StartupSettings machine={machineOf(reading)} fixture={fixture} />;
}

/** The owner declares its labels and controllers once for menu links, tabs, and full forms. */
export const MachineSettingsPanels: readonly SettingsPanel[] = [
  {
    id: "providers",
    label: "Providers and access",
    scope: "machine",
    surfaces: ["web", "pwa", "tray"],
    render: ProviderPanel,
  },
  {
    id: "sharing",
    label: "Sharing",
    scope: "machine",
    surfaces: ["web", "pwa", "tray"],
    render: SharingPanel,
  },
  {
    id: "startup",
    label: "Startup",
    scope: "machine",
    surfaces: ["web", "pwa", "tray"],
    render: StartupPanel,
  },
];
