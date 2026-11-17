import { LOSS_RULES } from "./loss-rules.ts";
/** Every table a rule may be looked up under: the one `ducts.tables` read. */
export const TABLE_IDS: readonly string[] = [
  ...new Set(LOSS_RULES.flatMap((rule) => rule.options)),
].sort();
