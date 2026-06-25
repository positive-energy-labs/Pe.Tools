import { cli } from "gunshi";
import {
  createPeCodeCliCommand,
  createPeCodeCliSubCommands,
  runPeCodeAcp,
  runPeCodeTui,
} from "./index.ts";

try {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await runPeCodeTui();
  } else if (isRootAcpInvocation(args)) {
    const options = parsePeCodeRootAcpOptions(args);
    await runPeCodeAcp({
      modelId: options.modelId,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
    });
  } else {
    await cli(args, createPeCodeCliCommand(), {
      name: "peco",
      version: "0.1.0",
      description: "Pe.Tools repo/dev CLI. Product/operator workflows live in pea.",
      subCommands: createPeCodeCliSubCommands(),
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function isRootAcpInvocation(args: string[]): boolean {
  return args.includes("--acp") && !args.some((arg) => arg === "--help" || arg === "-h");
}

function parsePeCodeRootAcpOptions(args: string[]): {
  modelId?: string;
  workspaceRoot?: string;
} {
  const consumed = new Set<number>();
  const modelId = parseStringArg(args, consumed, "--model-id", "--modelId");
  const workspaceRoot = parseStringArg(args, consumed, "--workspace-root", "--workspaceRoot");
  parseBooleanArg(args, consumed, "--acp");

  const unexpected = args.filter((_, index) => !consumed.has(index));
  if (unexpected.length > 0) {
    throw new Error(`Unsupported Peco ACP option: ${unexpected.join(" ")}`);
  }

  return { modelId, workspaceRoot };
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
