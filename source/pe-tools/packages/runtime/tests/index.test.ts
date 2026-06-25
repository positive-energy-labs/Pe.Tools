import { expect, test } from "vite-plus/test";
import { createRuntimeHarness, type RuntimeInjectedHarnessConfig } from "../src/index.ts";

test("runtime harness close closes injected storage", async () => {
  let storageClosed = false;
  const config: RuntimeInjectedHarnessConfig = {
    storage: {
      close: async () => {
        storageClosed = true;
      },
    },
  };
  const runtime = await createRuntimeHarness({
    config,
    harness: {},
  });

  expect(runtime.session).toBeUndefined();
  await runtime.close?.();
  expect(storageClosed).toBe(true);
});
