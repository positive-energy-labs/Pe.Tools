import path from "node:path";
import {
  createRuntimeLibSqlThreadIndex,
  getDefaultMastraCodeDatabasePath,
  runRuntimeWorkbenchWeb,
} from "@pe/runtime";
import { createPeCodeProtocolRuntimeFactory } from "./runtime.ts";

export interface PeCodeWebRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  host?: string;
  port?: number;
  modelId?: string;
  staticDir?: string;
  workbenchPort?: number;
  workbenchToken?: string;
}

export async function runPeCodeWeb(options: PeCodeWebRuntimeOptions = {}): Promise<void> {
  const startPath = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const factory = await createPeCodeProtocolRuntimeFactory({
    cwd: startPath,
    workspaceRoot: options.workspaceRoot,
    modelId: options.modelId,
  });

  await runRuntimeWorkbenchWeb({
    label: "peco",
    agent: {
      runtime: { factory },
      sessions: {
        defaultCwd: startPath,
        threadIndex: createRuntimeLibSqlThreadIndex({
          databasePath: getDefaultMastraCodeDatabasePath(),
          storageProfileKind: "mastracode-compatible",
        }),
      },
      transport: { port: options.workbenchPort ?? 0, token: options.workbenchToken },
    },
    static: {
      host: options.host,
      port: options.port,
      staticDir: options.staticDir,
      envVar: "PE_WORKBENCH_STATIC_DIR",
    },
  });
}
