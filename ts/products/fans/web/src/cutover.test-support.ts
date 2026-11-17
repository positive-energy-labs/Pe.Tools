import { witnessFactory } from "@pe/ducts-web/cutover.test-support";
import { nativeTestAdapter } from "@pe/ducts-web/native.test-support";
import { publishedPricing, publishedRoster } from "@pe/ducts-domain/published-calcs.fixture";
import { calcState } from "./calc/state.ts";
import { RosterBody, LedgerBody } from "./mount.tsx";
import { admit } from "./admission.fixture.ts";
export const createWitness = witnessFactory({
  admit, calcState,
  nativeTestAdapter: (mount, door) => nativeTestAdapter(mount, door, { "sheet-roster": RosterBody, "sheet-ledger": LedgerBody }),
  systemList: publishedRoster, pricingValue: publishedPricing, networkCalcs: () => publishedPricing().calcs,
});
