import type { FansDrawContext } from "./route";
import { cellMembers, selectedKeys } from "../ducts/cell-focus";
import { ductElements } from "../ducts/identity";
export function bindings(ctx:FansDrawContext) {
  const snapshot=ctx.value.value?.sheetSnapshot;
  const elements=ductElements(snapshot), selected=selectedKeys(ctx.selection.read().map(({id})=>id));
  return {selected,members:cellMembers(selected,elements),
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:!snapshot||"kind" in snapshot?[]:[...snapshot.nodes,...snapshot.segments].map(({id,uniqueId})=>({elementId:id,uniqueId}))}};
}
