import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { routeFolderCandidates } from "../../../scripts/route-startup.ts";
import { webSourceFiles } from "./route-closure-census.ts";

test("a planted product web folder is discovered when the web app has no route folders", () => {
  const root = mkdtempSync(join(tmpdir(), "pe-product-route-"));
  try {
    mkdirSync(join(root, "ts/apps/web/src"), { recursive: true });
    const product = join(root, "ts/products/planted/web");
    mkdirSync(product, { recursive: true });
    expect(routeFolderCandidates(root)).toEqual([product]);
    writeFileSync(join(product, "route.ts"), "export const module = {};");
    mkdirSync(join(product, "node_modules/installed"), { recursive: true });
    writeFileSync(join(product, "node_modules/installed/leak.ts"), "export const hidden = true;");
    expect(webSourceFiles(product)).toEqual(["route.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
