import { dispatchBrowserWorker } from "@pe/browser/worker";

try {
  if (!(await dispatchBrowserWorker())) await (await import("./cli.ts")).runPeaMain();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
