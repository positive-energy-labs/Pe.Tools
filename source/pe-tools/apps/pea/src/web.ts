import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runRuntimeAgentControllerWeb } from "@pe/runtime";
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
  await runRuntimeAgentControllerWeb<PeaTuiRuntimeOptions>({
    label: "pea",
    title: "Pea",
    createRuntime: createPeaRuntime,
    runtimeOptions,
    host: options.host,
    port: options.port,
    staticDir: options.staticDir ?? resolveInstalledStaticDir(),
    workbenchPort: options.workbenchPort,
    workbenchToken: options.workbenchToken,
  });
}

function resolveInstalledStaticDir(): string | undefined {
  const dir = resolve(dirname(process.execPath), "..", "web", "client");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}
