import { expect, test } from "vite-plus/test";
import { createRuntimeController, type RuntimeInjectedControllerConfig } from "../src/index.ts";

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
