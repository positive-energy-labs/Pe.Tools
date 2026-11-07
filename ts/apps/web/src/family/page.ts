import { z } from "zod";
import { routeAddress } from "@pe/agent-contracts";
export const FAMILY_MODEL_SCHEMA = "/schemas/settings/FamilyFoundry/models.json";
export const familyPageSchema = routeAddress("family").schema.extend({family:z.enum(["current"]).default("current")});
export type FamilyPage = z.output<typeof familyPageSchema>;
