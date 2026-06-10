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
import { createPeCodeProtocolRuntimeFactory, peCodeRuntimeToolProfile } from "./runtime.ts";

export {
  createPeCodeRuntimeAuthProfile,
  createPeCodeRuntimeFactory,
  createPeCodeProtocolRuntimeFactory,
  createPeCodeTuiRuntime,
  runPeCodeTui,
  defaultPeCodeRuntimeToolCatalog,
  defaultPeCodeRuntimeToolProfile,
} from "./runtime.ts";
export type { PeCodeRuntimeFactoryOptions } from "./runtime.ts";

export function createPeCodeCliCommand() {
  return define({
    name: "peco",
    description: "Pe.Tools repo/dev CLI.",
    toKebab: true,
    args: {
      ...argsAcp,
      ...argsAgui,
    },
    examples: [
      "peco",
      "peco --acp",
      "peco --ag-ui --ag-ui-port 43112",
      "peco live context",
      "peco live sync",
      'peco talk-to-pea --prompt "Review this operator flow"',
    ].join("\n"),
    run: async (ctx) => {
      if (ctx.values.acp) {
        const factory = await createPeCodeProtocolRuntimeFactory();
        await runRuntimeAcpFromCli(
          createRuntimeAcpCliOptions(ctx.values, { runtime: { factory } }),
        );
        return;
      }
      if (ctx.values.agUi) {
        const factory = await createPeCodeProtocolRuntimeFactory();
        await runRuntimeAgUiFromCli(
          createRuntimeAgUiCliOptions(ctx.values, { runtime: { factory } }),
        );
        return;
      }
      console.log("Run `peco --help` to list dev commands.");
      console.log(`host      ${PeHostClient.resolveHostBaseUrl()}`);
      console.log(`workspace ${PeHostClient.resolveWorkspaceKey()}`);
    },
  });
}

export function createPeCodeCliSubCommands() {
  const subCommands = peCodeRuntimeToolProfile.commands?.createSubCommands?.();
  if (!subCommands) throw new Error("peco runtime tool profile does not define CLI subcommands.");
  return subCommands;
}

export function getPeCodeCliCommandNames(): string[] {
  return Object.keys(createPeCodeCliSubCommands());
}
