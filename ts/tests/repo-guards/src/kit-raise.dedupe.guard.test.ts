/** Source census only: cannot prove collision avoidance, pointer timing or camera motion. */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), "latin1");
const lang = "packages/kit/src/components/lang/";

test("shared kit jobs have one owner and no app forwarding copies", () => {
  for (const file of [
    "collection.ts",
    "list-view.tsx",
    "rail.tsx",
    "../master-table/master-table-body.tsx",
  ])
    expect(read(lang + file)).not.toMatch(/scrollIntoView/);
  expect(read(lang + "collection.ts")).not.toMatch(/export type Reading\b/);
  expect(read(lang + "list-view.tsx")).not.toMatch(/total >= 60/);
  expect(read(lang + "../master-table/master-table-body.tsx")).not.toMatch(/const VIRTUAL_FROM/);
  expect(read(lang + "list-popup.tsx")).not.toMatch(/GoToPopup/);
  expect(existsSync(resolve(root, "apps/web/src/components/lang/minimap.tsx"))).toBe(false);
  expect(existsSync(resolve(root, "apps/web/src/scene/live-orbit.ts"))).toBe(false);
  for (const file of [
    lang + "floater.tsx",
    "apps/web/src/scene/framing.ts",
    "apps/web/src/scene/use-plane-viewport.ts",
  ])
    expect(read(file)).not.toMatch(/pane-dock/);
  const { exports } = JSON.parse(read("packages/kit/package.json"));
  for (const name of ["pane-strip", "rail", "search-control", "cell-state", "cell.css", "pane.css"])
    expect(exports[`./lang/${name}`]).toBeUndefined();
});
