import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

import { cn } from "#/lib/utils";

import { POPUP_SURFACE_CLASS } from "./popup";

test("Select and Combobox share the popup surface and keep caller width intent", () => {
  const shared = fileURLToPath(new URL("./popup.ts", import.meta.url));
  const foundation = readFileSync(shared, "utf8");
  const select = readFileSync(fileURLToPath(new URL("./select.tsx", import.meta.url)), "utf8");
  const combobox = readFileSync(fileURLToPath(new URL("./combobox.tsx", import.meta.url)), "utf8");

  expect(foundation).toContain(POPUP_SURFACE_CLASS);
  expect(select).toContain('import { POPUP_SURFACE_CLASS } from "./popup";');
  expect(combobox).toContain('import { POPUP_SURFACE_CLASS } from "./popup";');
  expect(combobox).toContain("w-max");
  expect(combobox).toContain("max-w-(--available-width)");
  expect(combobox).not.toContain(" w-(--anchor-width)");
  const callerWidth = cn("w-max min-w-(--anchor-width)", "min-w-56");
  expect(callerWidth).toContain("min-w-56");
  expect(callerWidth).not.toContain("min-w-(--anchor-width)");
});
