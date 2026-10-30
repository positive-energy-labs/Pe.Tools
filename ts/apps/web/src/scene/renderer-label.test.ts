import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("the model label distinguishes the element menu from its Revit action", () => {
  const source = readFileSync(new URL("./renderer.ts", import.meta.url), "utf8");
  const label = source.match(/"3D model\.[^"]+"/)![0];
  expect(label).toContain("Right-click opens the element menu");
  expect(label).toContain("B then X shows it in Revit");
  expect(label).not.toContain("right click or BX shows");
});
