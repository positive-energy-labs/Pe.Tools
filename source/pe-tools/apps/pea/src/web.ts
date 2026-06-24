import path from "node:path";
import {
  createRuntimeLibSqlThreadIndex,
  getDefaultPeaProductDatabasePath,
  runRuntimeWorkbenchWeb,
} from "@pe/runtime";
import { resolvePeaProductHomePath } from "@pe/tools";
import { createPeaProtocolRuntimeFactory, type PeaRuntimeAuthSource } from "./runtime.ts";

export interface PeaWebRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  host?: string;
  port?: number;
  staticDir?: string;
  modelId?: string;
  authSource?: PeaRuntimeAuthSource;
  noCloudAuth?: boolean;
  workbenchPort?: number;
  workbenchToken?: string;
}

export async function runPeaWeb(options: PeaWebRuntimeOptions = {}): Promise<void> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const productHomePath = resolvePeaProductHomePath();
  const factory = await createPeaProtocolRuntimeFactory({
    workspaceRoot,
    modelId: options.modelId,
    authSource: options.authSource,
    noCloudAuth: options.noCloudAuth,
  });

  await runRuntimeWorkbenchWeb({
    label: "Pea",
    agent: {
      runtime: { factory },
      sessions: {
        defaultCwd: productHomePath,
        threadIndex: createRuntimeLibSqlThreadIndex({
          databasePath: getDefaultPeaProductDatabasePath(),
          storageProfileKind: "pea-product-state",
        }),
      },
      transport: { port: options.workbenchPort, token: options.workbenchToken },
    },
    static: {
      host: options.host,
      port: options.port,
      staticDir: options.staticDir,
      envVar: "PE_WORKBENCH_STATIC_DIR",
    },
  });
}
