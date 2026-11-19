import { spawnSync } from "node:child_process";
import { expect, test } from "vite-plus/test";
import { root } from "./unification-2-census.ts";
test("product snapshot slots cannot bypass terminal-flow selection", () => {
  const hits = spawnSync("git", [
    "grep", "-n", "-E", "ductParameterSlots|ductSlotRequest", "--", "ts/products",
    ":(exclude)**/*.test.ts",
    // The contract projects named settings. Only the shared host resolver turns them into a snapshot request.
    ":(exclude)ts/products/duct-systems/contract/src/ducts.ts",
    ":(exclude)ts/products/ducts/host/src/ducts-inputs.ts",
  ], { cwd: root, encoding: "utf8" });
  expect(hits.status, hits.stdout).toBe(1);
  expect(hits.stdout).toBe("");
});
