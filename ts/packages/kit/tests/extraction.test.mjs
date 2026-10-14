import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const kit = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(kit, "../../apps/web/src");
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory() ? files(resolve(dir, item.name)) : [resolve(dir, item.name)],
  );
}

test("kit owns its implementation graph without app source or aliases", () => {
  const sources = files(resolve(kit, "src")).filter((file) => /\.(tsx?|css)$/.test(file));
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /apps[\\/]web|#\//, file);
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(?|@import\s*|@source\s*)["']([^"']+)["']/g,
    )) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier);
      assert.ok(
        target === resolve(kit, "src") ||
          target.startsWith(resolve(kit, "src") + "/") ||
          target.startsWith(resolve(kit, "src") + "\\"),
        `${file}: ${specifier} escapes kit source`,
      );
    }
  }
  assert.doesNotMatch(readFileSync(resolve(kit, "tsconfig.json"), "utf8"), /apps[\\/]web/);
});

test("the app consumes each instrument and stylesheet from its single kit owner", () => {
  const moved = [
    "components/lang/artifact-frame.tsx",
    "components/lang/pane-tabs.tsx",
    "components/lang/list-popup.tsx",
    "components/lang/input.tsx",
    "components/lang/code.tsx",
    "components/lang/button.tsx",
    "components/lang/diagram.tsx",
    "components/master-table/table.tsx",
    "base.css",
    "design-lang.css",
  ];
  for (const path of moved) {
    assert.ok(existsSync(resolve(kit, "src", path)), `${path} must be implemented in kit`);
    assert.ok(!existsSync(resolve(web, path)), `${path} must have no app copy or facade`);
  }
  assert.match(readFileSync(resolve(web, "styles.css"), "utf8"), /@pe\/kit\/base\.css/);
});
