import { define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import { PeCodeCliCommands } from "@pe/tools/dev";

export {
  createPeCodeRuntimeAuthProfile,
  createPeCodeRuntimeFactory,
  defaultPeCodeRuntimeToolCatalog,
} from "./runtime.ts";
export type { PeCodeRuntimeFactoryOptions } from "./runtime.ts";

export function createPeCodeCliCommand() {
  return define({
    name: "pe-code",
    description: "Pe.Tools repo/dev CLI.",
    toKebab: true,
    examples: [
      "pe-code",
      "pe-code live context",
      "pe-code live sync",
      'pe-code talk-to-pea --prompt "Review this operator flow"',
    ].join("\n"),
    run: () => {
      console.log("Run `pe-code --help` to list dev commands.");
      console.log(`host      ${PeHostClient.resolveHostBaseUrl()}`);
      console.log(`workspace ${PeHostClient.resolveWorkspaceKey()}`);
    },
  });
}

export function createPeCodeCliSubCommands() {
  return new PeCodeCliCommands().commands();
}

export function getPeCodeCliCommandNames(): string[] {
  return Object.keys(createPeCodeCliSubCommands());
}
