import type { DuctsDrawContext } from "./route";
import { attentionSubjects } from "./cell-focus";
export function bindings(ctx:DuctsDrawContext) {
  const snapshot=ctx.value.value?.network;
  return {selected:[...attentionSubjects(ctx.selection.read().map(({id})=>id))],
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:[...(snapshot?.nodes??[]),...(snapshot?.segments??[])].map(({id,uniqueId})=>({elementId:id,uniqueId}))}};
}
