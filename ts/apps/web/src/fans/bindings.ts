import type { FansDrawContext } from "./route";
import { attentionSubjects } from "../ducts/cell-focus";
import { localSubject } from "../ducts/identity";
export function bindings(ctx:FansDrawContext) {
  const snapshot=ctx.value.value?.sheetSnapshot;
  return {selected:[...attentionSubjects(ctx.selection.read().map(({id})=>localSubject(id)))],
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:!snapshot||"kind" in snapshot?[]:[...snapshot.nodes,...snapshot.segments].map(({id,uniqueId})=>({elementId:id,uniqueId}))}};
}
