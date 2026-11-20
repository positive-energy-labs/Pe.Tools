import { product } from "@pe/duct-systems-contract/product";
import { ductsRefreshExecutors, ductsRulingsExecutors } from "@pe/ducts-host/action-runtime";
import { ductSystemsExecutors } from "./actions.ts";
import type { RevitBridge } from "@pe/host-internal/bridge";
import type { DuctActionDependencies } from "@pe/ducts-host/action-runtime";

export const host = {
  product,
  sheet: ductsRulingsExecutors,
  executors: (bridge: RevitBridge["Service"], deps: DuctActionDependencies) => ({
    ...ductSystemsExecutors(bridge, deps),
    ...ductsRefreshExecutors(bridge),
  }),
};
