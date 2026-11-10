import type { RoomsContext } from "./route";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { roomSelection } from "./selection";
import { inboxCards } from "./cards";
import { railsOf } from "./layers";
export function bindings(ctx:RoomsContext) {
  const data=ctx.value.value,page=ctx.page.read(),regions=data?.snapshot.regions??[];
  const cards=ctx.cells.doc&&data?inboxCards(structuredClone(data.roomsWork) as import("@pe/agent-contracts").RoomsRouteDocument,structuredClone(data.snapshot) as import("@pe/host-contracts/generated").RoomsSnapshot.Res.Response,page.view):[];
  return {selected:roomSelection(page.picked,cards,regions.map(r=>r.guid)).guids.map(guid=>`room:${guid}` as SubjectKey),
    members:new Map(regions.map(region=>[`room:${region.guid}` as SubjectKey,[elementKey(region.uniqueId)]])),
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:[...regions.map(region=>({elementId:region.elementId,uniqueId:region.uniqueId})),...(data?.trace?railsOf(structuredClone(data.trace) as import("@pe/host-contracts/generated").RoomsTrace.Res.Response).map(r=>({elementId:r.elementId})):[])]}};
}
