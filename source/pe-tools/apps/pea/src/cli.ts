import { cli, define } from "gunshi";
import { PeHostClient } from "@pe/host-client";
import { parseOptionalPort, parseTuiRenderer, reexecWithNodeFfiIfNeeded } from "@pe/runtime";
import { PeaCliCommands } from "@pe/tools";

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
      "pea --ag-ui --ag-ui-port 43112",
      "pea host status",
      "pea script bootstrap",
      "pea script execute --source-path src\\SampleScript.cs",
    ].join("\n"),
    run: async (ctx) => {
      if (ctx.values.acp) {
        const [{ runRuntimeAcpAgent }, { createPeaProtocolRuntimeFactory }] = await Promise.all([
          import("@pe/runtime"),
          import("./runtime.ts"),
        ]);
        const factory = await createPeaProtocolRuntimeFactory({
          modelId: ctx.values.modelId,
          workspaceRoot: ctx.values.workspaceRoot,
        });
        await runRuntimeAcpAgent({ runtime: { factory } });
        return;
      }
      if (ctx.values.agUi) {
        const [
          { createRuntimeAgUiCliOptions, runRuntimeAgUiFromCli },
          { createPeaProtocolRuntimeFactory },
        ] = await Promise.all([import("@pe/runtime"), import("./runtime.ts")]);
        const factory = await createPeaProtocolRuntimeFactory({
          modelId: ctx.values.modelId,
          workspaceRoot: ctx.values.workspaceRoot,
        });
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
    "beta-tui": define({
      name: "beta-tui",
      description: "Run the beta Pea terminal workbench.",
      toKebab: true,
      args: betaTuiArgs,
      run: async (ctx) => {
        if (reexecWithNodeFfiIfNeeded()) return;
        debugBetaTuiCli("runtime import:start");
        const { runPeaBetaTui } = await import("./runtime.ts");
        debugBetaTuiCli("runtime import:ready");
        await runPeaBetaTui({
          workspaceRoot: ctx.values.workspaceRoot,
          renderer: parseTuiRenderer(ctx.values.renderer),
        });
      },
    }),
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
          agUiPort: parseOptionalPort(ctx.values.agUiPort),
          agUiToken: ctx.values.agUiToken,
        });
      },
    }),
  };
}

export function getPeaCliCommandNames(): string[] {
  return Object.keys(createPeaCliSubCommands());
}

const workspaceArgs = {
  workspaceRoot: {
    type: "string",
    description:
      "Pea product workspace root. Defaults to the directory where the Pea CLI is launched.",
  },
} as const;

const betaTuiArgs = {
  ...workspaceArgs,
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
      "Port for the web workbench AG-UI agent. Defaults to 43112; use 0 for an ephemeral port.",
  },
  agUiToken: {
    type: "string",
    description: "Bearer/query token for the web workbench AG-UI agent.",
  },
  ...workspaceArgs,
} as const;

const protocolArgs = {
  acp: {
    type: "boolean",
    description: "Run the runtime as an ACP agent over stdio.",
    default: false,
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
  ...workspaceArgs,
} as const;

function debugBetaTuiCli(label: string): void {
  if (process.env.PE_TUI_DEBUG_START !== "1") return;
  console.error(`[pea beta-tui cli] ${label}`);
}
