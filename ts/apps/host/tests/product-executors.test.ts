import { expect, test } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderProductAssembly } from "../../web/scripts/product-assembly.ts";

test("P-097: codegen refuses an unknown sheet executor via", () => {
  const root = mkdtempSync(join(tmpdir(), "pe-executor-"));
  try {
    const dir = join(root, "ts/products/custom/host");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "@pe/custom-host",
      exports: { "./actions": "./actions.ts" },
      pe: { executors: { module: "./actions", factory: "executors", arguments: [], sheet: { routes: ["custom"], via: "unknown" } } },
    }));
    expect(() => renderProductAssembly(root)).toThrow(/"sheet"\s*,\s*"via"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
