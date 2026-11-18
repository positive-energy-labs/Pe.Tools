import { expect, test } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderProductExecutors } from "../../web/scripts/product-executors.ts";

test("P-097: codegen refuses an unknown sheet executor via", () => {
  const root = mkdtempSync(join(tmpdir(), "pe-executor-"));
  try {
    const dir = join(root, "ts/products/custom/host");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ pe: { executors: { sheet: { via: "unknown" } } } }));
    expect(() => renderProductExecutors(root)).toThrow("Invalid sheet executor via");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
