import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { findMastraCodeResolveModelModuleUrl } from "../mastracode-model.js";

describe("MastraCode model resolver loading", () => {
  it("prefers the legacy model module when present", async () => {
    const root = join(tmpdir(), `pea-mastracode-model-legacy-${Date.now()}`);
    const legacyPath = join(root, "dist", "agents", "model.js");
    await mkdir(join(root, "dist", "agents"), { recursive: true });
    await writeFile(legacyPath, "export const resolveModel = () => null;", "utf-8");

    assert.equal(await findMastraCodeResolveModelModuleUrl(root), pathToFileURL(legacyPath).href);
  });

  it("discovers bundled resolver chunks when the legacy module is absent", async () => {
    const root = join(tmpdir(), `pea-mastracode-model-bundle-${Date.now()}`);
    const dist = join(root, "dist");
    const chunkPath = join(dist, "chunk-model.js");
    await mkdir(dist, { recursive: true });
    await writeFile(
      join(dist, "index.js"),
      "export { createMastraCode } from './chunk-runtime.js';",
      "utf-8",
    );
    await writeFile(
      chunkPath,
      "const resolveModel = () => null; export { resolveModel };",
      "utf-8",
    );

    assert.equal(await findMastraCodeResolveModelModuleUrl(root), pathToFileURL(chunkPath).href);
  });
});
