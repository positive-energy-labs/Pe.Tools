import { module as ducts } from "../route.ts";
import { fansRouteState } from "@pe/fans-contract/fans";
import { admitModules } from "@pe/ducts-web/admission.test-support";
import { contractOwner } from "@pe/ducts-web/work-owner.test-support";
import { witnessFactory } from "@pe/ducts-web/cutover.test-support";
import { nativeTestAdapter } from "@pe/ducts-web/native.test-support";
import { publishedPricing, publishedSheetView } from "@pe/ducts-domain/published-calcs.fixture";
import { systemList } from "@pe/duct-systems-domain/system-list";
import { pricingValue } from "@pe/duct-systems-domain/pricing-value";
import * as bodies from "./screen/screen.tsx";
export const createWitness = witnessFactory({
  admit: () => admitModules(ducts, contractOwner(fansRouteState, ducts.data.directory)),
  systemList, pricingValue, calcState: publishedSheetView, networkCalcs: () => publishedPricing().calcs,
  nativeTestAdapter: (mount, door) => nativeTestAdapter(mount, door, {
    "e-systems": bodies.SystemsPane, "e-sidebar": bodies.TreePane, "e-rules-all": bodies.AllRulesBody,
    "e-rules": bodies.RulesBody, "e-inbox": bodies.InboxBody,
  }),
});
