import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

/*
 * Slice 7's Delete falsifier: Fans draws no borrowed body, and its inputs render through the
 * sheet slot (a kernel `sheet` pane over `module.data.sheet`). Red at f42ca101: `sheet-inputs`
 * draws /ducts' `InputsBody`. Held red as `test.fails`: the census at `route/slots/sheet/index.ts`
 * names the /ducts-staged cells that have no home in Fans' sheet. Flip it to `test` when the port lands.
 */
test.fails("Fans draws no borrowed body; its inputs render through the sheet slot", async () => {
  expect(readFileSync(new URL("./route.ts", import.meta.url), "utf8")).not.toMatch(/"InputsBody"/);
  const { module } = await import("./route.ts");
  expect(Object.keys(module.data.sheet?.bindings ?? {})).toEqual(expect.arrayContaining(["designFriction", "parameters", "roles"]));
  expect(Object.values(module.spec.panes).some((p) => (p as { kernel?: string }).kernel === "sheet")).toBe(true);
});
