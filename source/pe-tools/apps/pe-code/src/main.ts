import { cli } from "gunshi";
import { createPeCodeCliCommand, createPeCodeCliSubCommands } from "./index.ts";

try {
  await cli(process.argv.slice(2), createPeCodeCliCommand(), {
    name: "pe-code",
    version: "0.1.0",
    description: "Pe.Tools repo/dev CLI. Product/operator workflows live in pea.",
    subCommands: createPeCodeCliSubCommands(),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
