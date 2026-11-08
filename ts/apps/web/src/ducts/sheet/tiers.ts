import { verdictInk } from "@pe/kit/table/cells";
import type { Tier } from "./model";
export { TIERS, type Tier } from "./model";
export * from "@pe/ducts-domain/sheet/tiers";
const TIER_TONE: Record<Tier, Parameters<typeof verdictInk>[0]> = { taken: "done", accept: "caution", preview: "alarm" };
export const tierInk = (tier: Tier) => verdictInk(TIER_TONE[tier]);
export const tierTone = (tier: Tier) => TIER_TONE[tier];
