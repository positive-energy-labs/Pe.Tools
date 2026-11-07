// Test-only entry for the byte-frozen DocLab witness. The declaration is the product's typed route.
import { workFingerprintSchema } from "@pe/agent-contracts";
import { builtinRouteStamp } from "../route/builtin-inventory";
import { module } from "./route";
import { familyPageSchema } from "./page";
export { familyPageSchema, FAMILY_MODEL_SCHEMA, type FamilyPage } from "./page";
export const familyGraph = { module, page: familyPageSchema, fingerprint: workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp("family")}`), staleMessage: "Work changed; edit the current family cells" };
