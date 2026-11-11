import type { RoomsContext } from "./route";
import { elementKey } from "@pe/kit/lang/attention";
import { regionSubject } from "./subject";
import { railsOf } from "./layers";
/** The open rooms are the selection: the subject's own SubjectRefs, with no second codec. */
export function bindings(ctx:RoomsContext) {
  const data=ctx.value.value,room=ctx.page.read().room,regions=data?.snapshot.regions??[];
  return {selected:room.kind === "all"?regions.map(r=>regionSubject(r.guid)):room.ids.map(id=>id as ReturnType<typeof regionSubject>),
    members:new Map(regions.map(region=>[regionSubject(region.guid),[elementKey(region.uniqueId)]])),
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:[...regions.map(region=>({elementId:region.elementId,uniqueId:region.uniqueId})),...(data?.trace?railsOf(structuredClone(data.trace) as import("@pe/host-contracts/generated").RoomsTrace.Res.Response).map(r=>({elementId:r.elementId})):[])]}};
}
