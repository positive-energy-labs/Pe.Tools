import { verdictInk } from "@pe/kit/table/cells";
import type { Tier } from "@pe/ducts-web/calc/model";
export { TIERS, type Tier } from "@pe/ducts-web/calc/model";
export * from "@pe/fans-domain/calc/tiers";
const TIER_TONE: Record<Tier, Parameters<typeof verdictInk>[0]> = {
  taken: "done",
  accept: "caution",
  preview: "alarm",
};
export const tierTone = (tier: Tier) => TIER_TONE[tier];
