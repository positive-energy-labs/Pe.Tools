import type { RoomsContext } from "./route";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { roomSelection } from "./selection";
import { inboxCards } from "./cards";
import { railsOf } from "./layers";
export function bindings(ctx:RoomsContext) {
  const data=ctx.value.value,page=ctx.page.read(),regions=data?.snapshot.regions??[];
  const cards=ctx.cells.doc&&data?inboxCards(ctx.cells.doc,data.snapshot,page.view):[];
  return {selected:roomSelection(page.picked,cards,regions.map(r=>r.guid)).guids.map(guid=>`room:${guid}` as SubjectKey),
    members:new Map(regions.map(region=>[`room:${region.guid}` as SubjectKey,[elementKey(region.elementId)]])),
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:[...regions.map(region=>({elementId:region.elementId})),...(data?.trace?railsOf(data.trace).map(r=>({elementId:r.elementId})):[])]}};
}
