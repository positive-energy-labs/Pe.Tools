import { defineRoute } from "#/route/manifest";
import { MachineSettingsPanels } from "./settings-panels";

/** Importing the owner registers its durable forms without mounting its runtime Page. */
export const machineManifest = defineRoute({
  key: "machine",
  name: "Machine",
  docs: "Runtime observations, attention, and repair actions. Open owns documents and binding; Settings owns configuration.",
  settingsPanels: MachineSettingsPanels,
});
