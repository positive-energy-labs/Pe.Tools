import { runRuntimeWorkbenchWeb } from "@pe/runtime";
import { createPeaRuntime, type PeaTuiRuntimeOptions } from "./runtime.ts";

export interface PeaWebOptions extends PeaTuiRuntimeOptions {
  host?: string;
  port?: number;
  staticDir?: string;
  workbenchPort?: number;
  workbenchToken?: string;
}

export async function runPeaWeb(options: PeaWebOptions = {}): Promise<void> {
  const runtimeOptions: PeaTuiRuntimeOptions = {
    ...options,
    workspaceRoot: options.workspaceRoot ?? options.cwd ?? process.cwd(),
  };
  await runRuntimeWorkbenchWeb<PeaTuiRuntimeOptions>({
    label: "pea",
    title: "Pea",
    createRuntime: createPeaRuntime,
    runtimeOptions,
    host: options.host,
    port: options.port,
    staticDir: options.staticDir,
    workbenchPort: options.workbenchPort,
    workbenchToken: options.workbenchToken,
  });
}
