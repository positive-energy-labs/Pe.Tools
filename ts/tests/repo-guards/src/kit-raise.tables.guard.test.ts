/** Text census cannot prove leader placement, native targeting or popover behavior. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const consumers = ["bar.tsx", "fan-sections.tsx"];
it("ducts imports the table and leader instruments instead of redrawing them", () => {
  const violations = consumers.flatMap((name) => {
    const text = readFileSync(resolve(root, "ts/apps/web/src/ducts/proto/e", name), "latin1");
    return /<table\b|<path\b/.test(text) || !text.includes("@pe/kit/lang/leader-diagram")
      ? [name]
      : [];
  });
  expect(violations).toEqual([]);
});
