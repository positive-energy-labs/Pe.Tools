import { cli } from "gunshi";
import { createPeaCliCommand, createPeaCliSubCommands } from "./index.ts";

try {
  await cli(process.argv.slice(2), createPeaCliCommand(), {
    name: "pea",
    version: "0.1.0",
    description: "Pea product/operator CLI. Dev workflows live in pe-code.",
    subCommands: createPeaCliSubCommands(),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
