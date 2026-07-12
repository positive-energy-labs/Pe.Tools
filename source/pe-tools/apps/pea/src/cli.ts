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

  if (isRootPromptInvocation(args)) {
    const { runPeaPrompt } = await import("./prompt.ts");
    const options = parsePeaRootPromptOptions(args);
    const exitCode = await runPeaPrompt(options);
    // The headless runtime leaves live handles (storage, controllers) behind even after a
    // best-effort close; exit explicitly so one-shot prompt runs always terminate.
    process.exit(exitCode);
  }

  await cli(args, createPeaCliCommand(), {
    name: "pea",
    version: "0.1.0",
    description: "Pea product/operator CLI.",
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
      'pea --prompt "Summarize the open Revit documents." --json',
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

function isRootPromptInvocation(args: string[]): boolean {
  return (
    args.some((arg) => arg === "--prompt" || arg.startsWith("--prompt=")) &&
    !args.some((arg) => arg === "--help" || arg === "-h")
  );
}

function parsePeaRootPromptOptions(args: string[]): {
  prompt: string;
  threadId?: string;
  json?: boolean;
  timeoutSeconds?: number;
} {
  const consumed = new Set<number>();
  const prompt = parseStringArg(args, consumed, "--prompt");
  const threadId = parseStringArg(args, consumed, "--thread", "--thread-id", "--threadId");
  const timeoutSecondsText = parseStringArg(args, consumed, "--timeout-seconds", "--timeoutSeconds");
  const json = parseBooleanArg(args, consumed, "--json");

  const unexpected = args.filter((_, index) => !consumed.has(index));
  if (unexpected.length > 0) {
    throw new Error(`Unsupported Pea prompt option: ${unexpected.join(" ")}`);
  }
  if (!prompt || prompt.trim().length === 0) {
    throw new Error("Provide a prompt: pea --prompt \"...\" [--thread <id>] [--json]");
  }

  let timeoutSeconds: number | undefined;
  if (timeoutSecondsText != null) {
    timeoutSeconds = Number(timeoutSecondsText);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error("--timeout-seconds must be a positive number.");
    }
  }

  return { prompt, threadId, json, timeoutSeconds };
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
  prompt: {
    type: "string",
    description:
      "Run one headless Pea turn and print { threadId, response }. Combine with --thread <id> to continue a thread and --json for machine-readable output.",
  },
  thread: {
    type: "string",
    description: "Existing Pea thread id to continue in --prompt mode.",
  },
  json: {
    type: "boolean",
    description: "Print the --prompt result as a single JSON object.",
    default: false,
  },
  timeoutSeconds: {
    type: "number",
    description: "Timeout for the --prompt turn in seconds (default 900).",
  },
  modelId: {
    type: "string",
    description: "Optional model id to force for the runtime.",
  },
  ...runtimeAuthArgs,
  ...workspaceArgs,
} as const;
