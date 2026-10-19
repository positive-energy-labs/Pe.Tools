import { expect, test } from "vite-plus/test";
import { capabilityCatalogSchema } from "../src/capability.ts";
import { machineFixture } from "./machine-fixture.ts";

const catalog = { at: "now", machine: machineFixture(), sources: {}, capabilities: [] };
const diagnostic = {
  code: "page.noncanonical-folder",
  folder: "Office_Page",
  canonicalSlug: "office-page",
  message: "Rename Office_Page to office-page to enable its doors.",
};
test("catalog diagnostics retain noncanonical Pages without fabricating action rows", () => {
  const parsed = capabilityCatalogSchema.parse({ ...catalog, diagnostics: [diagnostic] });
  expect(parsed.diagnostics).toEqual([diagnostic]);
  expect(parsed.capabilities).toEqual([]);
  expect(capabilityCatalogSchema.parse({ ...catalog, diagnostics: [] }).diagnostics).toEqual([]);
});
test("catalog diagnostics require an explicit array and a canonical rename destination", () => {
  expect(capabilityCatalogSchema.safeParse(catalog).success).toBe(false);
  for (const invalid of [
    { ...diagnostic, code: "other" },
    { ...diagnostic, canonicalSlug: "Office_Page" },
    { ...diagnostic, key: "page:@pages/Office_Page" },
  ])
    expect(capabilityCatalogSchema.safeParse({ ...catalog, diagnostics: [invalid] }).success).toBe(
      false,
    );
});
