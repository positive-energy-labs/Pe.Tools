import { witnessFactory } from "../ducts/cutover.test-support.ts";
import { nativeTestAdapter } from "../ducts/native.test-support.ts";
import { publishedPricing, publishedRoster } from "@pe/ducts-domain/published-calcs.fixture";
import { calcState } from "../../../../../../products/fans/web/src/calc/state.ts";
import { RosterBody, LedgerBody } from "../../../../../../products/fans/web/src/mount.tsx";
import { admit } from "../../../../../../products/fans/web/src/admission.fixture.ts";
export const createWitness = witnessFactory({
  admit,
  calcState,
  nativeTestAdapter: (mount, door) =>
    nativeTestAdapter(mount, door, { "calc-roster": RosterBody, "calc-ledger": LedgerBody }),
  systemList: publishedRoster,
  pricingValue: publishedPricing,
  networkCalcs: () => publishedPricing().calcs,
});
