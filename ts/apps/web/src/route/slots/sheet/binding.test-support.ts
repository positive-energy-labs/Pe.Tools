import {
  settingLayer,
  type BindingDraw,
  type BindingPer,
  type Domain,
  type SheetBinding,
} from "@pe/agent-contracts/slots/sheet";
import type { SettingTier, SettingTierRead } from "@pe/agent-contracts/tiered-setting";

export const local = (
  domain: Domain,
  per: BindingPer = "route",
  draw?: BindingDraw,
): SheetBinding => ({ ...draw, domain, per, home: { at: "local" } });
export const parameter = (parameter: string, domain: Domain, draw?: BindingDraw): SheetBinding => ({
  ...draw,
  domain,
  per: "subject",
  home: { at: "parameter", parameter },
});
export const store = (
  store: string,
  domain: Domain,
  per: BindingPer = "subject",
  draw?: BindingDraw,
): SheetBinding => ({ ...draw, domain, per, home: { at: "store", store } });
export function setting(
  owner: string,
  path: readonly string[],
  domain: Domain,
  tiers: readonly SettingTier[],
  draw?: BindingDraw,
): SheetBinding {
  const binding: SheetBinding = {
    ...draw,
    domain,
    per: "route",
    home: { at: "setting", owner, path, tiers },
  };
  return {
    ...binding,
    model:
      draw?.model ??
      ((read: { settings?: Record<string, readonly SettingTierRead[]> }) =>
        settingLayer(binding, read?.settings?.[owner])),
  };
}
