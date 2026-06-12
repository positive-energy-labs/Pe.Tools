import { stat } from "node:fs/promises";
import path from "node:path";
import { createInProcessAcpWorkbenchClient } from "@pe/acp-client";
import { createRuntimeAcpAgent } from "@pe/runtime";
import { createWorkbenchController } from "@pe/workbench-core";
import { startWorkbenchTransportServer } from "@pe/workbench-transport";
import { createPeCodeProtocolRuntimeFactory } from "./runtime.ts";

export interface PeCodeWebRuntimeOptions {
  cwd?: string;
  workspaceRoot?: string;
  host?: string;
  port?: number;
  modelId?: string;
  staticDir?: string;
}

export async function runPeCodeWeb(options: PeCodeWebRuntimeOptions = {}): Promise<void> {
  const startPath = path.resolve(options.workspaceRoot ?? options.cwd ?? process.cwd());
  const factory = await createPeCodeProtocolRuntimeFactory({
    cwd: startPath,
    workspaceRoot: options.workspaceRoot,
    modelId: options.modelId,
  });
  const cwd = process.cwd();
  const client = createInProcessAcpWorkbenchClient(
    (connection) => createRuntimeAcpAgent(connection, { runtime: { factory } }),
    { clientName: "peco web", clientVersion: "0.1.0" },
  );
  const controller = createWorkbenchController(client, { cwd });
  const staticDir = await resolveWorkbenchStaticDir(options.staticDir);
  const handle = await startWorkbenchTransportServer(controller, {
    host: options.host,
    port: options.port,
    staticDir,
  });

  if (staticDir) {
    console.log(`peco web workbench: ${handle.url}`);
    console.log(`peco web static: ${staticDir}`);
  } else {
    console.log(
      "peco web workbench: not serving React app; run `vp run website#build` or pass `--static-dir`.",
    );
  }
  console.log(`peco workbench API: ${handle.apiUrl}`);
  await waitForShutdown(() => handle.close());
}

async function resolveWorkbenchStaticDir(
  staticDir: string | undefined,
): Promise<string | undefined> {
  const configured = staticDir ?? process.env.PE_WORKBENCH_STATIC_DIR;
  if (configured) return path.resolve(configured);

  let current = path.resolve(process.cwd());
  while (true) {
    for (const candidate of [
      path.join(current, "apps", "website", "dist"),
      path.join(current, "source", "pe-tools", "apps", "website", "dist"),
    ]) {
      if (await hasIndexHtml(candidate)) return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function hasIndexHtml(directory: string): Promise<boolean> {
  const indexStat = await stat(path.join(directory, "index.html")).catch(() => undefined);
  return indexStat?.isFile() ?? false;
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  let closing = false;
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void close().finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
