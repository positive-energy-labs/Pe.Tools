import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vite-plus/test";
import {
  buildAgentControllerApp,
  createRuntimeController,
  type RuntimeInjectedControllerConfig,
} from "../src/index.ts";
import { createPeaRuntime } from "../src/pea-runtime.ts";

test("runtime controller close closes injected storage", async () => {
  let storageClosed = false;
  const config: RuntimeInjectedControllerConfig = {
    storage: {
      close: async () => {
        storageClosed = true;
      },
    },
  };
  const runtime = await createRuntimeController({
    config,
    controller: {},
  });

  expect(runtime.session).toBeUndefined();
  await runtime.close?.();
  expect(storageClosed).toBe(true);
});

test("buildAgentControllerApp mounts the /pe/info handshake for a pea runtime", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pea-app-"));
  const runtime = await createPeaRuntime({ workspaceRoot });

  try {
    const app = await buildAgentControllerApp({ runtime, label: "pea" });
    const response = await app.fetch(new Request("http://local/pe/info"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      controllerId: "pea",
      resourceId: runtime.session?.identity.getResourceId(),
    });
  } finally {
    await runtime.close?.();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 30_000);
