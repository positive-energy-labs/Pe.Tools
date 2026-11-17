import type { RevitBridge } from "./bridge.ts";
import type { DuctActionDependencies } from "./ducts-action-runtime.ts";
import { ductsRefreshExecutors } from "./ducts-action-runtime.ts";
import { fansExecutors } from "./fans-actions.ts";
import { ductSystemsExecutors } from "./duct-systems-actions.ts";
export { lossPlanRefusal, lossSnapshot, claimRefusal, fanWriteRequest, unwrittenCells, unwrittenReason } from "./fans-actions.ts";
export { healSnapshot, healedCellPaths } from "./duct-systems-actions.ts";
export function ductsExecutors(bridge: RevitBridge["Service"], deps: DuctActionDependencies = {}) {
  return { ...ductsRefreshExecutors(bridge), ...fansExecutors(bridge, deps), ...ductSystemsExecutors(bridge, deps) };
}
