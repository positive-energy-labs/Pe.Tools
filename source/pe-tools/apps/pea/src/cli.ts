import { cli, define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import { parseOptionalPort, runRuntimeAcpAgent } from "@pe/runtime";
import { PeaCliCommands } from "@pe/tools";
import type { PeaRuntimeAuthSource } from "./runtime.ts";

export async function runPeaMain(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 0) {
    const { runPeaTui } = await import("./runtime.ts");
    await runPeaTui({ workspaceRoot: process.cwd() });
    return;
  }

  await cli(args, createPeaCliCommand(), {
    name: "pea",
    version: "0.1.0",
    description: "Pea product/operator CLI. Dev workflows live in peco.",
    subCommands: createPeaCliSubCommands(),
  });
}

export function createPeaCliCommand() {
  return define({
    name: "pea",
    description: "Pea product/operator CLI.",
    toKebab: true,
    args: protocolArgs,
    examples: [
      "pea",
      "pea web",
      "pea --acp",
      "pea host status",
      "pea script bootstrap",
      "pea script execute --source-path src\\SampleScript.cs",
    ].join("\n"),
    run: async (ctx) => {
      if (ctx.values.acp) {
        const { createPeaProtocolRuntimeFactory } = await import("./runtime.ts");
        const factory = await createPeaProtocolRuntimeFactory({
          modelId: ctx.values.modelId,
          workspaceRoot: ctx.values.workspaceRoot,
          authSource: resolvePeaCliAuthSource(ctx.values.authSource),
          noCloudAuth: ctx.values.noCloudAuth,
        });
        await runRuntimeAcpAgent({ runtime: { factory } });
        return;
      }
      console.log("Run `pea --help` to list product commands.");
      console.log(`host      ${PeHostClient.resolveHostBaseUrl()}`);
      console.log(`workspace ${PeHostClient.resolveWorkspaceKey()}`);
    },
  });
}

export function createPeaCliSubCommands() {
  return {
    ...new PeaCliCommands().commands(),
    web: define({
      name: "web",
      description: "Run the local React Pea workbench over HTTP/SSE.",
      toKebab: true,
      args: webArgs,
      run: async (ctx) => {
        const { runPeaWeb } = await import("./web.ts");
        await runPeaWeb({
          host: ctx.values.host,
          port: parseOptionalPort(ctx.values.port),
          staticDir: ctx.values.staticDir,
          modelId: ctx.values.modelId,
          workspaceRoot: ctx.values.workspaceRoot,
          authSource: resolvePeaCliAuthSource(ctx.values.authSource),
          noCloudAuth: ctx.values.noCloudAuth,
          workbenchPort: parseOptionalPort(ctx.values.workbenchPort),
          workbenchToken: ctx.values.workbenchToken,
        });
      },
    }),
  };
}

export function getPeaCliCommandNames(): string[] {
  return Object.keys(createPeaCliSubCommands());
}

function resolvePeaCliAuthSource(value: string | undefined): PeaRuntimeAuthSource | undefined {
  if (value == null || value.length === 0) return undefined;
  if (isPeaRuntimeAuthSource(value)) return value;
  throw new Error(
    `Unsupported Pea auth source '${value}'. Use gateway, auto, api-key, oauth, or mastra-gateway.`,
  );
}

function isPeaRuntimeAuthSource(value: string): value is PeaRuntimeAuthSource {
  return (
    value === "gateway" ||
    value === "auto" ||
    value === "api-key" ||
    value === "oauth" ||
    value === "mastra-gateway"
  );
}

const workspaceArgs = {
  workspaceRoot: {
    type: "string",
    description:
      "Pea product workspace root. Defaults to the directory where the Pea CLI is launched.",
  },
} as const;

const runtimeAuthArgs = {
  authSource: {
    type: "string",
    description:
      "Runtime auth source: gateway, auto, api-key, oauth, or mastra-gateway. Defaults to gateway.",
  },
  noCloudAuth: {
    type: "boolean",
    description: "Use local provider/API-key auth and do not advertise Pea Cloud Gateway auth.",
    default: false,
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
  ...runtimeAuthArgs,
  workbenchPort: {
    type: "string",
    description:
      "Port for the web workbench HTTP/SSE agent. Defaults to 43112; use 0 for an ephemeral port.",
  },
  workbenchToken: {
    type: "string",
    description: "Local connection token for the workbench HTTP/SSE agent.",
  },
  ...workspaceArgs,
} as const;

const protocolArgs = {
  acp: {
    type: "boolean",
    description: "Run the runtime as an ACP agent over stdio.",
    default: false,
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
  ...runtimeAuthArgs,
  ...workspaceArgs,
} as const;
