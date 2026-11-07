import type { Priced } from "./pricing.ts";
import type { LossResult } from "./losses.ts";
import type { HealPlan } from "./heal.ts";
/** Published results are JSON. Solver collections never cross the read boundary. */
export type JsonView<T> = T extends ReadonlyMap<infer K,infer V> ? Record<Extract<K,string|number>,JsonView<V>> : T extends ReadonlySet<infer V> ? JsonView<V>[] : T extends readonly unknown[] ? {[K in keyof T]:JsonView<T[K]>} : T extends object ? {[K in keyof T]:JsonView<T[K]>} : T;
export type PricedView=JsonView<Priced>;
export type LossView=JsonView<LossResult>;
export type HealView=JsonView<HealPlan>;

/** Scoped unit-flow projection on the published records; no survey or solve runs here. */
export function unitFlowsView(surveyed:Pick<PricedView,"equipmentFlows"|"fanFlows">,groups:readonly string[]|null) {
  return Object.fromEntries(Object.entries(surveyed.equipmentFlows).map(([id,flow])=>{
    if(!groups||(flow.cfm!=null&&flow.source!=="derived")) return [id,flow];
    const there=groups.flatMap(g=>{const f=surveyed.fanFlows[g]?.[Number(id)];return f?.source === "derived"&&f.cfm!=null?[f]:[];});
    return [id,there.length?{cfm:there.reduce((a,f)=>a+f.cfm!,0),source:"derived",grilles:there.reduce((a,f)=>a+(f.grilles??0),0)}:{cfm:null,source:null}];
  }));
}
