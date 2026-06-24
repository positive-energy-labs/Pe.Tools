import { define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import { argsAcp, parseOptionalPort, runRuntimeAcpAgent } from "@pe/runtime";
import { createPeCodeProtocolRuntimeFactory, peCodeRuntimeToolProfile } from "./runtime.ts";

export {
  createPeCodeProtocolRuntimeFactory,
  createPeCodeTuiRuntime,
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
    },
    examples: [
      "peco",
      "peco web",
      "peco --acp",
      "peco live context",
      "peco live sync",
      'peco talk-to-pea --prompt "Review this operator flow"',
    ].join("\n"),
    run: async (ctx) => {
      if (ctx.values.acp) {
        const factory = await createPeCodeProtocolRuntimeFactory({
          modelId: ctx.values.modelId,
        });
        await runRuntimeAcpAgent({ runtime: { factory } });
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
          workbenchPort: parseOptionalPort(ctx.values.workbenchPort),
          workbenchToken: ctx.values.workbenchToken,
        });
      },
    }),
  };
}

export function getPeCodeCliCommandNames(): string[] {
  return Object.keys(createPeCodeCliSubCommands());
}

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
  workbenchPort: {
    type: "string",
    description:
      "Port for the web workbench HTTP/SSE agent. Defaults to an ephemeral port; use 0 for an ephemeral port.",
  },
  workbenchToken: {
    type: "string",
    description: "Local connection token for the workbench HTTP/SSE agent.",
  },
} as const;
