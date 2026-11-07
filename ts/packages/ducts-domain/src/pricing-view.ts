import type { DuctsPricingData } from "@pe/agent-contracts";
/** The accepted schema owns JSON projection types; the solver's collections stay private. */
export type PricedView=DuctsPricingData["priced"];
export type LossView=PricedView["next"];
export type HealView=DuctsPricingData["analysis"]["heal"];

export function unitFlowView(surveyed:Pick<PricedView,"equipmentFlows"|"fanFlows">,unit:number,groups:readonly string[]|null) {
  return unitFlowsView(surveyed,groups)[unit]??{cfm:null,source:null};
}
/** Scoped unit-flow projection on the published records; no survey or solve runs here. */
export function unitFlowsView(surveyed:Pick<PricedView,"equipmentFlows"|"fanFlows">,groups:readonly string[]|null) {
  return Object.fromEntries(Object.entries(surveyed.equipmentFlows).map(([id,flow])=>{
    if(!groups||(flow.cfm!=null&&flow.source!=="derived")) return [id,flow];
    const there=groups.flatMap(g=>{const f=surveyed.fanFlows[g]?.[Number(id)];return f?.source === "derived"&&f.cfm!=null?[f]:[];});
    return [id,there.length?{cfm:there.reduce((a,f)=>a+f.cfm!,0),source:"derived",grilles:there.reduce((a,f)=>a+(f.grilles??0),0)}:{cfm:null,source:null}];
  }));
}
