import { cli, define } from "gunshi";
import { renderUsage } from "gunshi/renderer";
import { harnessIds, type HarnessId } from "@pe/agent-contracts";
import { PeaCliCommands, discoverHostBaseUrl, resolveWorkspaceKey } from "@pe/mcps";
import type { PeaPromptRequest } from "./prompt.ts";

export async function runPeaMain(args = process.argv.slice(2)): Promise<void> {
  if (isRootPromptInvocation(args)) {
    const { runPeaPrompt } = await import("./prompt.ts");
    const options = parsePeaRootPromptOptions(args);
    const exitCode = await runPeaPrompt(options);
    // Exit explicitly so a dangling SSE socket never keeps a one-shot run alive.
    process.exit(exitCode);
  }

  await cli(args, createPeaCliCommand(), {
    name: "pea",
    version: "0.1.0",
    description: "Pea product/operator CLI.",
    subCommands: createPeaCliSubCommands(),
    fallbackToEntry: true,
    // The banner goes to stdout; a --json command's stdout is exactly one JSON object.
    ...(args.includes("--json") ? { renderHeader: null } : {}),
  });
}

export function createPeaCliCommand() {
  return define({
    name: "pea",
    description: "Pea product/operator CLI.",
    toKebab: true,
    examples: [
      "pea",
      'pea --prompt "Summarize the open Revit documents." --json',
      "pea host status",
      "pea script bootstrap",
      "pea script execute --source-path src\\SampleScript.cs",
    ].join("\n"),
    args: protocolArgs,
    run: async (ctx) => {
      console.log(await renderUsage(ctx));
      console.log(`host      ${discoverHostBaseUrl() ?? "(not running — vp run @pe/host#dev)"}`);
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

function isRootPromptInvocation(args: string[]): boolean {
  return (
    args.some((arg) => arg === "--prompt" || arg.startsWith("--prompt=")) &&
    !args.some((arg) => arg === "--help" || arg === "-h")
  );
}

function parsePeaRootPromptOptions(args: string[]): PeaPromptRequest {
  const consumed = new Set<number>();
  const prompt = parseStringArg(args, consumed, "--prompt");
  const modelId = parseStringArg(args, consumed, "--model", "--model-id", "--modelId");
  const threadId = parseStringArg(args, consumed, "--thread", "--thread-id", "--threadId");
  const timeoutSecondsText = parseStringArg(
    args,
    consumed,
    "--timeout-seconds",
    "--timeoutSeconds",
  );
  const harness = parseStringArg(args, consumed, "--harness") ?? "claude";
  const json = parseBooleanArg(args, consumed, "--json");
  const allow = parseBooleanArg(args, consumed, "--allow");

  const unexpected = args.filter((_, index) => !consumed.has(index));
  if (unexpected.length > 0) {
    throw new Error(`Unsupported Pea prompt option: ${unexpected.join(" ")}`);
  }
  if (!prompt || prompt.trim().length === 0) {
    throw new Error('Provide a prompt: pea --prompt "..." [--thread <id>] [--json]');
  }
  if (!harnessIds.includes(harness as HarnessId)) {
    throw new Error(`--harness must be one of: ${harnessIds.join(", ")}.`);
  }

  let timeoutSeconds: number | undefined;
  if (timeoutSecondsText != null) {
    timeoutSeconds = Number(timeoutSecondsText);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error("--timeout-seconds must be a positive number.");
    }
  }

  return {
    prompt,
    harness: harness as HarnessId,
    threadId,
    modelId,
    json,
    timeoutSeconds,
    allow,
  };
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

const protocolArgs = {
  prompt: {
    type: "string",
    description:
      "Run one headless turn on a host harness thread and print { ok, threadId, harness, model, stopReason, response }.",
  },
  harness: {
    type: "string",
    description: "Harness for a new --prompt thread: claude (default) or codex.",
  },
  thread: {
    type: "string",
    description: "Existing harness thread id to continue in --prompt mode.",
  },
  allow: {
    type: "boolean",
    description: "Answer --prompt permission requests with allow_once (default reject_once).",
    default: false,
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
    description: "Optional model id for the --prompt harness thread.",
  },
} as const;
