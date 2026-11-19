import type { DuctsPricingData } from "@pe/agent-contracts";

/**
 * What the /ducts panes read: the survey (flows, roles, findings, staged Work values) and every
 * roster fan's calc. The calcs are the only pricing; there is no group result beside them.
 */
export type Priced = DuctsPricingData["survey"] & { calcs: DuctsPricingData["calcs"] };

import { ruleByKey } from "@pe/ducts-domain/loss-rules";

/** Every fitting the calcs priced under this rule, once per element. */
const fittingsOf = (priced: Pick<Priced, "calcs">, key: string) => [
  ...new Map(
    priced.calcs.flatMap((calc) =>
      calc.fittings.flatMap((f) => (f.rule === key ? [[f.key, f] as const] : [])),
    ),
  ).values(),
];
/** The table a rule's fittings are looked up under now: the staged one, else the calcs', else the rule's own. */
export const tableOf = (priced: Pick<Priced, "calcs" | "effective">, key: string) =>
  (
    priced.effective.rules[key]?.table ??
    fittingsOf(priced, key).find((f) => f.table)?.table ??
    ruleByKey(key)?.table ??
    ""
  ).toUpperCase();
/** The table a rule stood on before any staged pick: a calc's table no person typed, else the rule's own. */
export const appliedTableOf = (priced: Pick<Priced, "calcs">, key: string) =>
  (
    fittingsOf(priced, key).find((f) => f.table && f.tableSource !== "typed")?.table ??
    ruleByKey(key)?.table ??
    ""
  ).toUpperCase();
/** How many of a rule's fittings no calc priced. */
export const unpriced = (priced: Pick<Priced, "calcs">, key: string) =>
  fittingsOf(priced, key).filter((f) => f.lossInWg == null).length;
