import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

import { POPUP_COMBOBOX_WIDTH_CLASS, POPUP_SURFACE_CLASS } from "./popup";

const source = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("popup CSS composes anchor, caller minimum, content growth, and viewport ceiling", () => {
  expect(POPUP_COMBOBOX_WIDTH_CLASS).toBe(
    "w-max min-w-[min(var(--available-width),max(var(--anchor-width),var(--popup-min-width,0px)))] max-w-(--available-width)",
  );
  expect(POPUP_COMBOBOX_WIDTH_CLASS).toContain("--anchor-width");
  expect(POPUP_COMBOBOX_WIDTH_CLASS).toContain("--popup-min-width");
  expect(POPUP_COMBOBOX_WIDTH_CLASS).toContain("--available-width");
  expect(POPUP_COMBOBOX_WIDTH_CLASS).toContain("w-max");
  expect(POPUP_SURFACE_CLASS).toContain("on-artifact");

  expect(source("./combobox.tsx")).toContain("POPUP_COMBOBOX_WIDTH_CLASS");
  for (const [file, minimum] of [
    ["../master-table/master-table.tsx", "11rem"],
    ["../control-chips.tsx", "14rem"],
    ["../../routes/design-system_.popovers.tsx", "11rem"],
    ["../../routes/design-system_.popovers.tsx", "14rem"],
    ["../../routes/design-system_.swatch.tsx", "13rem"],
  ]) {
    expect(source(file)).toContain(`[--popup-min-width:${minimum}]`);
  }
});
