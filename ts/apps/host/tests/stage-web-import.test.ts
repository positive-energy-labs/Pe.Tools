import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

test("staging loads Page library sources before a host lane exists", () => {
  const stage = new URL("../scripts/stage-web.ts", import.meta.url);
  const source = readFileSync(stage, "utf8");
  // Execute staging's actual Jiti import edge, without the SPA/Pod copy side effects.
  const edge = source.slice(source.indexOf('const { createJiti }'), source.indexOf("for (const [name, source]"));
  const env = { ...process.env };
  delete env.PE_LANE;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createJiti } from "jiti";
    assert.equal(process.env.PE_LANE, undefined);
    const result = await createJiti(${JSON.stringify(fileURLToPath(stage))}).evalModule(
      ${JSON.stringify(edge + "\nexport { PAGE_LIBRARY_SOURCES }; ")},
      { filename: ${JSON.stringify(fileURLToPath(stage))}, async: true }
    );
    assert.equal(result.PAGE_LIBRARY_SOURCES["pe.js"], "./pages/pe.js");
    assert.equal(result.PAGE_LIBRARY_SOURCES["kit/pe-kit.css"], "../../../packages/kit/dist/pe-kit.css");
    assert.equal(process.env.PE_LANE, undefined);
  `], { env, encoding: "utf8", timeout: 30_000 });
  expect(child.stderr, child.error?.message).toBe("");
  expect(child.status, child.stdout + child.stderr).toBe(0);
});
