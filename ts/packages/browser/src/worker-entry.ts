import { dispatchBrowserWorker } from "./worker.ts";

try {
  if (!(await dispatchBrowserWorker())) throw new Error("Browser worker mode required");
} catch (error) {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
}
