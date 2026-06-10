import { define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import {
  argsAcp,
  argsAgui,
  createRuntimeAcpCliOptions,
  createRuntimeAgUiCliOptions,
  runRuntimeAcpFromCli,
  runRuntimeAgUiFromCli,
} from "@pe/runtime";
import { createPeaProtocolRuntimeFactory, peaRuntimeToolProfile } from "./runtime.ts";

export {
  createPeaRuntimeAuthProfile,
  createPeaRuntimeFactory,
  createPeaProtocolRuntimeFactory,
  createPeaTuiRuntime,
  runPeaTui,
  defaultPeaRuntimeToolCatalog,
  defaultPeaRuntimeToolProfile,
} from "./runtime.ts";
export type { PeaRuntimeFactoryOptions } from "./runtime.ts";

export function createPeaCliCommand() {
  return define({
    name: "pea",
    description: "Pea product/operator CLI.",
    toKebab: true,
    args: {
      ...argsAcp,
      ...argsAgui,
    },
    examples: [
      "pea",
      "pea --acp",
      "pea --ag-ui --ag-ui-port 43112",
      "pea host status",
      "pea script bootstrap",
      "pea script execute --source-path src\\SampleScript.cs",
    ].join("\n"),
    run: async (ctx) => {
      if (ctx.values.acp) {
        const factory = await createPeaProtocolRuntimeFactory();
        await runRuntimeAcpFromCli(
          createRuntimeAcpCliOptions(ctx.values, { runtime: { factory } }),
        );
        return;
      }
      if (ctx.values.agUi) {
        const factory = await createPeaProtocolRuntimeFactory();
        await runRuntimeAgUiFromCli(
          createRuntimeAgUiCliOptions(ctx.values, { runtime: { factory } }),
        );
        return;
      }
      console.log("Run `pea --help` to list product commands.");
      console.log(`host      ${PeHostClient.resolveHostBaseUrl()}`);
      console.log(`workspace ${PeHostClient.resolveWorkspaceKey()}`);
    },
  });
}

export function createPeaCliSubCommands() {
  const subCommands = peaRuntimeToolProfile.commands?.createSubCommands?.();
  if (!subCommands) throw new Error("Pea runtime tool profile does not define CLI subcommands.");
  return subCommands;
}

export function getPeaCliCommandNames(): string[] {
  return Object.keys(createPeaCliSubCommands());
}
