import type { DuctsPricingData, DuctsRosterData, Immutable } from "@pe/agent-contracts";
import type { pricingResult } from "@pe/ducts-domain/pricing-result";
type PricingView = ReturnType<typeof pricingResult>;
const numeric = <T>(record: Readonly<Record<string, T>>) =>
  new Map(Object.entries(record).map(([key, value]) => [Number(key), value]));
/** Restore the domain's collection representation from the decoded host Value. No solve runs here. */
export function pricingView(data: Immutable<DuctsPricingData>): PricingView {
  const { priced, ready, analysis } = data;
  return {
    priced: {
      ...priced,
      flows: numeric(priced.flows),
      equipmentFlows: numeric(priced.equipmentFlows),
      roles: numeric(priced.roles),
      fanFlows: new Map(
        Object.entries(priced.fanFlows).map(([group, flows]) => [group, numeric(flows)]),
      ),
    },
    ready,
    analysis: {
      ...analysis,
      notes: new Map(Object.entries(analysis.notes)),
      heal: {
        ...analysis.heal,
        covered: new Set(analysis.heal.covered),
        hard: new Map(Object.entries(analysis.heal.hard)),
      },
    },
    // Circuit evidence and row extension fields are JSON in the public schema. Renderers retain it verbatim.
  } as unknown as PricingView;
}

/** Row extensions stay JSON on the wire; the drawing uses the domain's complete row shape. */
export const rosterView = (data: Immutable<DuctsRosterData>) =>
  data.rows as unknown as ReturnType<typeof import("@pe/ducts-domain/system-list").systemList>;
