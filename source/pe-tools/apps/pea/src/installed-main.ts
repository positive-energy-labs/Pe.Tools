import { runPeaMain } from "./cli.ts";

try {
  await runPeaMain();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
