import { cli, define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import { PeaCliCommands } from "@pe/tools";

export async function runPeaMain(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 0) {
    const { runPeaTui } = await import("./runtime.ts");
    await runPeaTui();
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
      "pea --ag-ui --ag-ui-port 43112",
      "pea host status",
      "pea script bootstrap",
      "pea script execute --source-path src\\SampleScript.cs",
    ].join("\n"),
    run: async (ctx) => {
      if (ctx.values.acp) {
        const [
          { createRuntimeAcpCliOptions, runRuntimeAcpFromCli },
          { createPeaProtocolRuntimeFactory },
        ] = await Promise.all([import("@pe/runtime"), import("./runtime.ts")]);
        const factory = await createPeaProtocolRuntimeFactory();
        await runRuntimeAcpFromCli(
          createRuntimeAcpCliOptions(ctx.values, { runtime: { factory } }),
        );
        return;
      }
      if (ctx.values.agUi) {
        const [
          { createRuntimeAgUiCliOptions, runRuntimeAgUiFromCli },
          { createPeaProtocolRuntimeFactory },
        ] = await Promise.all([import("@pe/runtime"), import("./runtime.ts")]);
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
        });
      },
    }),
  };
}

export function getPeaCliCommandNames(): string[] {
  return Object.keys(createPeaCliSubCommands());
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
} as const;

const protocolArgs = {
  acp: {
    type: "boolean",
    description: "Run the runtime as an ACP agent.",
    default: false,
  },
  acpTransport: {
    type: "string",
    description: "ACP transport: stdio or http. Defaults to stdio.",
    default: "stdio",
  },
  acpPort: {
    type: "string",
    description: "Port for ACP HTTP transport. Defaults to 43111; use 0 for an ephemeral port.",
  },
  acpToken: {
    type: "string",
    description: "Bearer/query token for ACP HTTP transport. Defaults to a generated token.",
  },
  agUi: {
    type: "boolean",
    description: "Run the runtime as a native AG-UI HTTP/SSE agent.",
    default: false,
  },
  agUiPort: {
    type: "string",
    description:
      "Port for native AG-UI HTTP/SSE transport. Defaults to 43112; use 0 for an ephemeral port.",
  },
  agUiToken: {
    type: "string",
    description:
      "Bearer/query token for native AG-UI HTTP/SSE transport. Defaults to no token for local development.",
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
} as const;

function parseOptionalPort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(`Invalid port: ${value}`);
  return port;
}
