import { expect, it } from "vite-plus/test";
import { ductsFirmSchema } from "@pe/ducts-contract/duct-inputs";
import { ductParameterSlots } from "@pe/ducts-contract/system-work";
import { ductsApplyInputSchema } from "@pe/duct-systems-contract/ducts";
import type { SettingTierRead } from "@pe/agent-contracts/tiered-setting";
import { ductsSettings } from "@pe/ducts-contract/settings";
import { schemaOf } from "@pe/agent-contracts/slots/sheet";

const slots = (parameters: object) =>
  Object.fromEntries(
    Object.entries(
      ductParameterSlots([
        {
          tier: "firm",
          home: "firm",
          name: "Firm",
          path: "Settings/ducts.json",
          sha256: null,
          json: ductsFirmSchema.parse({ parameters }),
        },
      ] satisfies SettingTierRead[]),
    ).flatMap(([key, slot]) => (slot.name == null ? [] : [[key, slot.name]])),
  );
it("a firm can name RequiredEsp", () => {
  expect(slots({ requiredEsp: "My_RequiredESP" })).toEqual({ requiredEsp: "My_RequiredESP" });
});
it("an explicit empty RequiredEsp survives as writes nowhere", () => {
  expect(slots({ requiredEsp: "" })).toEqual({ requiredEsp: "" });
  expect(ductsSettings["setting.ducts.parameters.requiredEsp"]?.label).toContain("writes nowhere");
});
it("RequiredEsp cannot overwrite RatedEsp", () => {
  const schema = ductsApplyInputSchema.shape.slots;
  expect(schema.safeParse(slots({ requiredEsp: "ESP", ratedEsp: "esp" })).success).toBe(false);
  expect(schema.safeParse(slots({ requiredEsp: "Required", ratedEsp: "Rated" })).success).toBe(
    true,
  );
});
it.each([
  "ratedEsp",
  "fanFlow",
  "terminalFlow",
  "terminalDrop",
  "componentDrop",
  "fittingCoefficient",
] as const)("P-113: %s refuses an empty name in both the settings row and file", (key) => {
  expect(ductsFirmSchema.safeParse({ parameters: { [key]: "" } }).success).toBe(false);
  expect(
    schemaOf(ductsSettings[`setting.ducts.parameters.${key}`]!.domain).safeParse("").success,
  ).toBe(false);
});
