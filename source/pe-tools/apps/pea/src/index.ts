import { define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import { PeaCliCommands } from "@pe/tools/pea";

export {
  createPeaRuntimeAuthProfile,
  createPeaRuntimeFactory,
  defaultPeaRuntimeToolCatalog,
} from "./runtime.ts";
export type { PeaRuntimeFactoryOptions } from "./runtime.ts";

export function createPeaCliCommand() {
  return define({
    name: "pea",
    description: "Pea product/operator CLI.",
    toKebab: true,
    examples: [
      "pea",
      "pea host status",
      "pea script bootstrap",
      "pea script execute --source-path src\\SampleScript.cs",
    ].join("\n"),
    run: () => {
      console.log("Run `pea --help` to list product commands.");
      console.log(`host      ${PeHostClient.resolveHostBaseUrl()}`);
      console.log(`workspace ${PeHostClient.resolveWorkspaceKey()}`);
    },
  });
}

export function createPeaCliSubCommands() {
  return new PeaCliCommands().commands();
}

export function getPeaCliCommandNames(): string[] {
  return Object.keys(createPeaCliSubCommands());
}
