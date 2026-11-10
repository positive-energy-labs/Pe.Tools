import type { RoomsContext } from "./route";
import { elementKey } from "@pe/kit/lang/attention";
import { regionSubject } from "./subject";
import { roomSelection } from "./selection";
import { inboxCards } from "./cards";
import { railsOf } from "./layers";
export function bindings(ctx:RoomsContext) {
  const data=ctx.value.value,page=ctx.page.read(),regions=data?.snapshot.regions??[];
  const cards=ctx.cells.doc&&data?inboxCards(structuredClone(data.roomsWork) as import("@pe/agent-contracts").RoomsRouteDocument,structuredClone(data.snapshot) as import("@pe/host-contracts/generated").RoomsSnapshot.Res.Response,page.view):[];
  return {selected:roomSelection(page.picked,cards,regions.map(r=>r.guid)).guids.map(regionSubject),
    members:new Map(regions.map(region=>[regionSubject(region.guid),[elementKey(region.uniqueId)]])),
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:[...regions.map(region=>({elementId:region.elementId,uniqueId:region.uniqueId})),...(data?.trace?railsOf(structuredClone(data.trace) as import("@pe/host-contracts/generated").RoomsTrace.Res.Response).map(r=>({elementId:r.elementId})):[])]}};
}
