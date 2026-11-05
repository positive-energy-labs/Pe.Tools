import { expect, test } from "vite-plus/test";
import { createPluginRuntime } from "@pe/agent-contracts";

test("failed activation and duplicate keys roll back only the failed scope", async () => {
  const runtime = createPluginRuntime<string>();
  await runtime.install({
    id: "first",
    setup(c) {
      c.contribute("key", "first");
    },
  });
  await runtime.install({
    id: "second",
    setup(c) {
      c.contribute("key", "second");
    },
  });
  expect(runtime.contributions()).toEqual(["first"]);
  expect(runtime.inventory().find((p) => p.id === "second")?.status).toBe("error");
  await runtime.install({
    id: "broken",
    setup(c) {
      c.contribute("partial", "partial");
      throw Error("activation failed");
    },
  });
  expect(runtime.contributions()).toEqual(["first"]);
  await runtime.close();
});
