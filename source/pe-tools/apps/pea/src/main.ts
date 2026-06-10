import { cli } from "gunshi";
import { createPeaCliCommand, createPeaCliSubCommands, runPeaTui } from "./index.ts";

try {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await runPeaTui();
  } else {
    await cli(args, createPeaCliCommand(), {
      name: "pea",
      version: "0.1.0",
      description: "Pea product/operator CLI. Dev workflows live in peco.",
      subCommands: createPeaCliSubCommands(),
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
