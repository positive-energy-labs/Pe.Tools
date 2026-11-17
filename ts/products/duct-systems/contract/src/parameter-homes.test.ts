import { expect, it } from "vite-plus/test";
import { ductsFirmSchema } from "@pe/ducts-contract/duct-inputs";
import { ductParameterSlots, ductsApplyInputSchema } from "@pe/duct-systems-contract/ducts";
import type { SettingTierRead } from "@pe/agent-contracts/tiered-setting";
import { ductsSettings } from "@pe/agent-contracts/setting-owners";

const slots = (parameters: object) => ductParameterSlots([{
  tier: "firm", home: "firm", name: "Firm", path: "Settings/ducts.json", sha256: null,
  json: ductsFirmSchema.parse({ parameters }),
}] satisfies SettingTierRead[]);
it("a firm can name RequiredEsp", () => {
  expect(slots({ requiredEsp: "My_RequiredESP" })).toEqual({ requiredEsp: "My_RequiredESP" });
});
it("an explicit empty RequiredEsp survives as writes nowhere", () => {
  expect(slots({ requiredEsp: "" })).toEqual({ requiredEsp: "" });
  expect(ductsSettings["setting.ducts.parameters.requiredEsp"]?.domain).toMatchObject({ choices: [{ value: "", label: "writes nowhere" }] });
});
it("RequiredEsp cannot overwrite RatedEsp", () => {
  const schema = ductsApplyInputSchema.shape.slots;
  expect(schema.safeParse(slots({ requiredEsp: "ESP", ratedEsp: "esp" })).success).toBe(false);
  expect(schema.safeParse(slots({ requiredEsp: "Required", ratedEsp: "Rated" })).success).toBe(true);
});
