import { ductsSettingOwner } from "@pe/ducts-contract/settings";
import type { SettingOwner } from "@pe/agent-contracts/setting-owners";

export const settingOwners: Readonly<Record<string, SettingOwner>> = Object.freeze({
  ducts: ductsSettingOwner,
});
