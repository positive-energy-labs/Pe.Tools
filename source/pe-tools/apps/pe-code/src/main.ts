import { cli } from "gunshi";
import { createPeCodeCliCommand, createPeCodeCliSubCommands, runPeCodeTui } from "./index.ts";

try {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await runPeCodeTui();
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
