import { cli, define } from "gunshi";
import { PeaCliCommands, resolveHostBaseUrl, resolveWorkspaceKey } from "@pe/mcps";
import type { PeaRuntimeAuthSource } from "./runtime.ts";

export async function runPeaMain(args = process.argv.slice(2)): Promise<void> {
  if (isRootAcpInvocation(args)) {
    const { runPeaAcp } = await import("./runtime.ts");
    const options = parsePeaRootAcpOptions(args);
    await runPeaAcp({
      modelId: options.modelId,
      workspaceRoot: options.workspaceRoot,
      authSource: resolvePeaCliAuthSource(options.authSource),
      noCloudAuth: options.noCloudAuth,
    });
    return;
  }

  await cli(args, createPeaCliCommand(), {
    name: "pea",
    version: "0.1.0",
    description: "Pea product/operator CLI. Dev workflows live in peco.",
    subCommands: createPeaCliSubCommands(),
    fallbackToEntry: true,
  });
}

export function createPeaCliCommand() {
  return define({
    name: "pea",
    description: "Pea product/operator CLI.",
    toKebab: true,
    examples: [
      "pea",
      "pea --acp",
      "pea host status",
      "pea script bootstrap",
      "pea script execute --source-path src\\SampleScript.cs",
    ].join("\n"),
    args: protocolArgs,
    run: async (ctx) => {
      if (ctx.values.acp) {
        const { runPeaAcp } = await import("./runtime.ts");
        await runPeaAcp({
          modelId: ctx.values.modelId,
          workspaceRoot: ctx.values.workspaceRoot,
          authSource: resolvePeaCliAuthSource(ctx.values.authSource),
          noCloudAuth: ctx.values.noCloudAuth,
        });
        return;
      }

      const { runPeaTui } = await import("./runtime.ts");
      await runPeaTui({
        modelId: ctx.values.modelId,
        workspaceRoot: ctx.values.workspaceRoot,
        authSource: resolvePeaCliAuthSource(ctx.values.authSource),
        noCloudAuth: ctx.values.noCloudAuth,
      });

      console.log("Run `pea --help` to list product commands.");
      console.log(`host      ${resolveHostBaseUrl()}`);
      console.log(`workspace ${resolveWorkspaceKey()}`);
    },
  });
}

export function createPeaCliSubCommands() {
  return {
    ...new PeaCliCommands().commands(),
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

function isRootAcpInvocation(args: string[]): boolean {
  return args.includes("--acp") && !args.some((arg) => arg === "--help" || arg === "-h");
}

function parsePeaRootAcpOptions(args: string[]): {
  modelId?: string;
  workspaceRoot?: string;
  authSource?: string;
  noCloudAuth?: boolean;
} {
  const consumed = new Set<number>();
  const modelId = parseStringArg(args, consumed, "--model-id", "--modelId");
  const workspaceRoot = parseStringArg(args, consumed, "--workspace-root", "--workspaceRoot");
  const authSource = parseStringArg(args, consumed, "--auth-source", "--authSource");
  const noCloudAuth = parseBooleanArg(args, consumed, "--no-cloud-auth", "--noCloudAuth");
  parseBooleanArg(args, consumed, "--acp");

  const unexpected = args.filter((_, index) => !consumed.has(index));
  if (unexpected.length > 0) {
    throw new Error(`Unsupported Pea ACP option: ${unexpected.join(" ")}`);
  }

  return { modelId, workspaceRoot, authSource, noCloudAuth };
}

function parseStringArg(
  args: string[],
  consumed: Set<number>,
  ...names: string[]
): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    for (const name of names) {
      if (arg === name) {
        const value = args[index + 1];
        if (!value || value.startsWith("-")) throw new Error(`Missing value for ${name}.`);
        consumed.add(index);
        consumed.add(index + 1);
        return value;
      }

      const prefix = `${name}=`;
      if (arg.startsWith(prefix)) {
        consumed.add(index);
        return arg.slice(prefix.length);
      }
    }
  }
  return undefined;
}

function parseBooleanArg(args: string[], consumed: Set<number>, ...names: string[]): boolean {
  let found = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (names.includes(arg)) {
      consumed.add(index);
      found = true;
    }
  }
  return found;
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
    description: "Pea product workspace root. Defaults to ~/Documents/Pe.Tools.",
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

const protocolArgs = {
  acp: {
    type: "boolean",
    description: "Run Pea as an ACP agent over stdio.",
    default: false,
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
  ...runtimeAuthArgs,
  ...workspaceArgs,
} as const;
