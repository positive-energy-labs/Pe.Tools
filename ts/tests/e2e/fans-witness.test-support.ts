import { module as ducts } from "@pe/duct-systems-web/route";
import { module as fans } from "@pe/fans-web/route";
import { RosterBody, LedgerBody } from "@pe/fans-web/mount";
import * as bodies from "@pe/duct-systems-web/screen/screen";
import { networkCalcs } from "@pe/fans-domain/calc/network-calcs";
import { systemList } from "@pe/duct-systems-domain/system-list";
import { pricingValue } from "@pe/duct-systems-domain/pricing-value";
import { calcState } from "@pe/fans-web/calc/state";
import { admitModules } from "@pe/ducts-web/admission.test-support";
import { witnessFactory } from "../../apps/web/src/integration/products/ducts/cutover.test-support.ts";
import { nativeTestAdapter } from "../../apps/web/src/integration/products/ducts/native.test-support.ts";
export const createWitness = witnessFactory({
  admit: () => admitModules(ducts, fans), networkCalcs, systemList, pricingValue, calcState,
  nativeTestAdapter: (mount, door) => nativeTestAdapter(mount, door, {
    "calc-roster": RosterBody, "calc-ledger": LedgerBody, "e-systems": bodies.SystemsPane,
    "e-sidebar": bodies.TreePane, "e-rules-all": bodies.AllRulesBody, "e-rules": bodies.RulesBody, "e-inbox": bodies.InboxBody,
  }),
});
export const admit = (version = "fans-fixture") => admitModules(ducts, fans, version);
