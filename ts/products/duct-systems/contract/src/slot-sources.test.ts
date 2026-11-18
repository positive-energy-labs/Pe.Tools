import { expect, test } from "vite-plus/test";
import { ductSlotSourcesSchema, ductSlotRequest, slotLayer } from "./ducts.ts";

test("slot sources refuse retired model and user tiers", () => {
  for (const source of ["model", "user"])
    expect(ductSlotSourcesSchema.safeParse({ fanFlow: { name: null, source } }).success).toBe(false);
});

test("slot rows keep the native name and the served provenance", () => {
  const slotSources = ductSlotSourcesSchema.parse({ fanFlow: { name: "Configured", source: "firm", ref: "firm.json" } });
  expect(slotLayer({ slots: { fanFlow: "Native" }, slotSources }, "fanFlow")).toEqual({ value: "Native", name: "Configured", source: "firm", ref: "firm.json" });
  expect(slotLayer({ slots: { fanFlow: "Native" } }, "fanFlow")).toEqual({ value: "Native", source: "default" });
  expect(ductSlotRequest()).toEqual({});
});
