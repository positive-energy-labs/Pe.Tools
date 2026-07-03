import { define } from "gunshi";
import { parseOptionalPort } from "@pe/runtime";
import { resolveHostBaseUrl, resolveWorkspaceKey } from "@pe/tools";
import { peCodeRuntimeToolProfile } from "./runtime.ts";
import { runPeCodeWeb } from "./web.ts";

export {
  closePeCodeRuntime,
  createPeCodeRuntime,
  createPeCodeTuiRuntime,
  runPeCodeAcp,
  runPeCodeTui,
  defaultPeCodeRuntimeToolCatalog,
  defaultPeCodeRuntimeToolProfile,
  defaultPeCodeSandboxAllowedPath,
} from "./runtime.ts";
export { runPeCodeWeb } from "./web.ts";

export function createPeCodeCliCommand() {
  return define({
    name: "peco",
    description: "Pe.Tools repo/dev CLI.",
    toKebab: true,
    examples: [
      "peco",
      "peco --acp",
      "peco live context",
      "peco live sync",
      'peco talk-to-pea --prompt "Review this operator flow"',
    ].join("\n"),
    args: protocolArgs,
    run: async (ctx) => {
      if (ctx.values.acp) {
        const { runPeCodeAcp } = await import("./runtime.ts");
        await runPeCodeAcp({
          modelId: ctx.values.modelId,
          workspaceRoot: ctx.values.workspaceRoot,
        });
        return;
      }

      console.log("Run `peco --help` to list dev commands.");
      console.log(`host      ${resolveHostBaseUrl()}`);
      console.log(`workspace ${resolveWorkspaceKey()}`);
    },
  });
}

const protocolArgs = {
  acp: {
    type: "boolean",
    description: "Run Peco as an ACP agent over stdio.",
    default: false,
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
  workspaceRoot: {
    type: "string",
    description: "Peco workspace root. Defaults to the current repo root.",
  },
} as const;

const webArgs = {
  host: {
    type: "string",
    description: "Host interface for the web workbench server. Defaults to 127.0.0.1.",
  },
  port: {
    type: "string",
    description: "Port for the static website server. Defaults to an ephemeral port.",
  },
  staticDir: {
    type: "string",
    description: "Optional built website directory to serve.",
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
  workbenchPort: {
    type: "string",
    description: "Port for the workbench HTTP/SSE API. Defaults to an ephemeral port for Peco.",
  },
  workbenchToken: {
    type: "string",
    description: "Local connection token for the workbench HTTP/SSE API.",
  },
  workspaceRoot: {
    type: "string",
    description: "Peco workspace root. Defaults to the current repo root.",
  },
} as const;

export function createPeCodeCliSubCommands() {
  const subCommands = peCodeRuntimeToolProfile.commands?.createSubCommands?.();
  if (!subCommands) throw new Error("peco runtime tool profile does not define CLI subcommands.");
  return {
    ...subCommands,
    web: define({
      name: "web",
      description: "Run the local React Peco workbench over HTTP/SSE.",
      toKebab: true,
      args: webArgs,
      run: async (ctx) => {
        await runPeCodeWeb({
          host: ctx.values.host,
          port: parseOptionalPort(ctx.values.port),
          staticDir: ctx.values.staticDir,
          modelId: ctx.values.modelId,
          workspaceRoot: ctx.values.workspaceRoot,
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
