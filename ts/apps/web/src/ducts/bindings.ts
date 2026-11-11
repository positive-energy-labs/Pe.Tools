import type { DuctsDrawContext } from "./route";
import { cellMembers, selectedKeys } from "./cell-focus";
import { ductElements } from "./identity";
export function bindings(ctx:DuctsDrawContext) {
  const snapshot=ctx.value.value?.network;
  const elements=ductElements(snapshot), selected=selectedKeys(ctx.selection.read().map(({id})=>id));
  return {selected,members:cellMembers(selected,elements),
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:[...(snapshot?.nodes??[]),...(snapshot?.segments??[])].map(({id,uniqueId})=>({elementId:id,uniqueId}))}};
}
