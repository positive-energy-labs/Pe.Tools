import { runRuntimeWorkbenchWeb } from "@pe/runtime";
import {
  closePeCodeRuntime,
  createPeCodeRuntime,
  type PeCodeTuiRuntimeOptions,
} from "./runtime.ts";

export interface PeCodeWebOptions extends PeCodeTuiRuntimeOptions {
  host?: string;
  port?: number;
  staticDir?: string;
  workbenchPort?: number;
  workbenchToken?: string;
}

export async function runPeCodeWeb(options: PeCodeWebOptions = {}): Promise<void> {
  const runtimeOptions: PeCodeTuiRuntimeOptions = {
    cwd: options.cwd,
    workspaceRoot: options.workspaceRoot,
    modelId: options.modelId,
    additionalDirectories: options.additionalDirectories,
  };
  await runRuntimeWorkbenchWeb<PeCodeTuiRuntimeOptions>({
    label: "peco",
    title: "Peco",
    createRuntime: async (runtimeOptions: PeCodeTuiRuntimeOptions) => {
      const runtime = await createPeCodeRuntime(runtimeOptions);
      return { ...runtime, close: () => closePeCodeRuntime(runtime) };
    },
    runtimeOptions,
    host: options.host,
    port: options.port,
    staticDir: options.staticDir,
    workbenchPort: options.workbenchPort ?? 0,
    workbenchToken: options.workbenchToken,
  });
}
