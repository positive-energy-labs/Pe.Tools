import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

/*
 * Slice 7's Delete falsifier: Fans draws no borrowed body, and its inputs render through the
 * sheet slot (a kernel `sheet` pane over `module.data.sheet`). Red at f42ca101: `sheet-inputs`
 * draws /ducts' `InputsBody`. Green after the split by owner (ruling 2026-11-10).
 */
test("Fans draws no borrowed body; its inputs render through the sheet slot", async () => {
  expect(readFileSync(new URL("./route.ts", import.meta.url), "utf8")).not.toMatch(/"InputsBody"/);
  const { module } = await import("./route.ts");
  expect(Object.keys(module.data.sheet?.bindings ?? {})).toEqual(expect.arrayContaining(["writeIntent", "parameters", "roles", "esp", "flows", "terminalDrops", "componentDrops", "equipmentFlows"]));
  expect(Object.values(module.spec.panes).some((p) => (p as { kernel?: string }).kernel === "sheet")).toBe(true);
});
