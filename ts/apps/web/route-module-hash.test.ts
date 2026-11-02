import { expect, test } from "vite-plus/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { routeModuleHash } from "./route-module-hash.ts";

test("build stamps actual source bytes rather than the directory hash", async () => {
  const id = new URL("./src/captures/graph.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
  const source = readFileSync(id, "utf8");
  const plugin = routeModuleHash();
  const transform = plugin.transform as Function;
  const result = await transform(source, id);
  expect(result.code).toContain(
    `moduleHash: "${createHash("sha256").update(readFileSync(id)).digest("hex")}"`,
  );
  expect(result.code).not.toContain("ROUTE_DIRECTORY");
});
