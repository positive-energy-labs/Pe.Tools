import { NATIVE_BODY_VERSION_HEADER, readingRequestSchema } from "@pe/agent-contracts";
import type { SettingOwner } from "@pe/agent-contracts/setting-owners";
import { DUCTS_REFRESH_HEADER, ductsReadingSchema } from "@pe/ducts-contract/reading";
import { ductsSettingOwner } from "@pe/ducts-contract/settings";

export type { DuctsReadingEnvelope } from "@pe/ducts-contract/reading";

export const resourceReadingSchema = readingRequestSchema.or(ductsReadingSchema);

export const settingOwners: Readonly<Record<string, SettingOwner>> = Object.freeze({
  ducts: ductsSettingOwner,
});

export const readingBasisHeaders = (headers: Readonly<Record<string, string | undefined>>) => ({
  version: headers[NATIVE_BODY_VERSION_HEADER],
  refresh: headers[DUCTS_REFRESH_HEADER],
});
