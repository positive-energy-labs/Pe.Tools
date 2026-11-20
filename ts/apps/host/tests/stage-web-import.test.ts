import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";

test("staging loads Page library sources before a host lane exists", () => {
  const stage = new URL("../scripts/stage-web.ts", import.meta.url);
  const source = readFileSync(stage, "utf8");
  // Execute staging's actual Jiti import edge, without the SPA/Pod copy side effects.
  const edge = source.slice(
    source.indexOf("const { createJiti }"),
    source.indexOf("for (const [name, source]"),
  );
  const env = { ...process.env };
  delete env.PE_LANE;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
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
  `,
    ],
    { env, encoding: "utf8", timeout: 30_000 },
  );
  expect(child.stderr, child.error?.message).toBe("");
  expect(child.status, child.stdout + child.stderr).toBe(0);
});

test("staging refuses a development kit and copies a production kit", async () => {
  const stage = new URL("../scripts/stage-web.ts", import.meta.url);
  const source = readFileSync(stage, "utf8");
  const loop = source.slice(
    source.indexOf("for (const [name, source]"),
    source.indexOf("console.log(`staged page assets"),
  );
  const fixture = mkdtempSync(join(tmpdir(), "pe-stage-kit-"));
  const kit = join(fixture, "pe-kit.js");
  const pages = join(fixture, "pages");
  const copy = join(pages, "kit", "pe-kit.js");
  // Run the real asset loop with disposable inputs, without requiring a web build or exporting Pods.
  const run = () =>
    createJiti(fileURLToPath(stage), { moduleCache: false }).evalModule(
      `
    import { cpSync, mkdirSync, readFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    import { fileURLToPath } from "node:url";
    const pages = ${JSON.stringify(pages)};
    const PAGE_LIBRARY_SOURCES = { "kit/pe-kit.js": ${JSON.stringify(pathToFileURL(kit).href)} };
    ${loop}
  `,
      { filename: fileURLToPath(stage), async: true },
    );
  try {
    writeFileSync(kit, 'export const draw = jsxDEV("div", {});');
    await expect(run()).rejects.toThrow(
      "is a development build (jsxDEV); rebuild @pe/kit with NODE_ENV=production",
    );
    expect(existsSync(copy)).toBe(false);
    const production = 'export const draw = jsx("div", {});';
    writeFileSync(kit, production);
    await run();
    expect(readFileSync(copy, "utf8")).toBe(production);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
