import { define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import {
  argsAcp,
  argsAgui,
  createRuntimeAgUiCliOptions,
  parseOptionalPort,
  parseTuiRenderer,
  reexecWithNodeFfiIfNeeded,
  runRuntimeAcpAgent,
  runRuntimeAgUiFromCli,
} from "@pe/runtime";
import { createPeCodeProtocolRuntimeFactory, peCodeRuntimeToolProfile } from "./runtime.ts";

export {
  createPeCodeProtocolRuntimeFactory,
  createPeCodeBetaTuiWorkbenchOptions,
  createPeCodeTuiRuntime,
  runPeCodeBetaTui,
  runPeCodeTui,
  defaultPeCodeRuntimeToolCatalog,
  defaultPeCodeRuntimeToolProfile,
  defaultPeCodeSandboxAllowedPath,
} from "./runtime.ts";
export { runPeCodeWeb } from "./web.ts";
export type { PeCodeWebRuntimeOptions } from "./web.ts";

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
      "peco beta-tui",
      "peco web",
      "peco --acp",
      "peco --ag-ui --ag-ui-port 43112",
      "peco live context",
      "peco live sync",
      'peco talk-to-pea --prompt "Review this operator flow"',
    ].join("\n"),
    run: async (ctx) => {
      if (ctx.values.acp) {
        const factory = await createPeCodeProtocolRuntimeFactory({ modelId: ctx.values.modelId });
        await runRuntimeAcpAgent({ runtime: { factory } });
        return;
      }
      if (ctx.values.agUi) {
        const factory = await createPeCodeProtocolRuntimeFactory({ modelId: ctx.values.modelId });
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
  return {
    ...subCommands,
    "beta-tui": define({
      name: "beta-tui",
      description: "Run the beta Peco terminal workbench.",
      toKebab: true,
      args: betaTuiArgs,
      run: async (ctx) => {
        if (reexecWithNodeFfiIfNeeded()) return;
        const { runPeCodeBetaTui } = await import("./runtime.ts");
        await runPeCodeBetaTui({
          workspaceRoot: ctx.values.workspaceRoot,
          modelId: ctx.values.modelId,
          renderer: parseTuiRenderer(ctx.values.renderer),
        });
      },
    }),
    web: define({
      name: "web",
      description: "Run the local React peco workbench over HTTP/SSE.",
      toKebab: true,
      args: webArgs,
      run: async (ctx) => {
        const { runPeCodeWeb } = await import("./web.ts");
        await runPeCodeWeb({
          host: ctx.values.host,
          port: parseOptionalPort(ctx.values.port),
          staticDir: ctx.values.staticDir,
          modelId: ctx.values.modelId,
          agUiPort: parseOptionalPort(ctx.values.agUiPort),
          agUiToken: ctx.values.agUiToken,
        });
      },
    }),
  };
}

export function getPeCodeCliCommandNames(): string[] {
  return Object.keys(createPeCodeCliSubCommands());
}

const betaTuiArgs = {
  workspaceRoot: {
    type: "string",
    description:
      "Peco workspace root. Defaults to the nearest repo/project root from the launch directory.",
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
  renderer: {
    type: "string",
    description:
      "Beta TUI renderer: opentui, charsm, glyph, rezi, or nberlette. Defaults to opentui.",
  },
} as const;

const webArgs = {
  host: {
    type: "string",
    description: "Host interface for the web workbench server. Defaults to 127.0.0.1.",
  },
  port: {
    type: "string",
    description: "Port for the web workbench server. Defaults to an ephemeral port.",
  },
  staticDir: {
    type: "string",
    description: "Optional built website directory to serve from the workbench server.",
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
  agUiPort: {
    type: "string",
    description:
      "Port for the web workbench AG-UI agent. Defaults to an ephemeral port; use 0 for an ephemeral port.",
  },
  agUiToken: {
    type: "string",
    description: "Bearer/query token for the web workbench AG-UI agent.",
  },
} as const;
