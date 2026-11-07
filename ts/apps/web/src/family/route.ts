import { z } from "zod";
import { commands, familyDraftRouteState, routeStatePatchSchema, settingsCandidate, valueRead, type FamilyDraft } from "@pe/agent-contracts";
import { familyAddress } from "../../../../packages/agent-contracts/src/routes/family";
import { familyQueries } from "../../../../packages/mcps/src/shared/query-client";
import { runSemanticAction, actionResult } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { route, field, command, sessionCommand, queryAction, type DrawContext } from "../route/typed-route";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { familyArgs, familyData } from "./value";
import { presentFamilyPlan } from "./review";
const address = familyAddress.fields;
const fields = {
  stage: field(address.stage.schema, "audit", "pose", "push"),
  pod: field(address.pod.schema, "", "query", "push"), path: field(address.path.schema, "", "query", "push"),
  pane: field(address.pane.schema, "spec", "pose"),
  query: field(address.query.schema, "", "query"), sort: field(address.sort.schema, {columns:[]}, "query"), hidden: field(address.hidden.schema, {}, "query"),
  overlay: field(address.overlay.schema, "draft", "pose", "push"), drill: field(address.drill.schema, "", "pose", "push"),
  inspector: field(address.inspector.schema, "", "pose"), doc: field(address.doc.schema, "text", "pose"),
};
const loaded = {...hostRead(valueRead("family.workspace",familyArgs,familyData)), args:(page:{pod:string;path:string})=>({member:page.pod&&page.path?{pod:page.pod,path:page.path}:null})};
const edits = z.array(routeStatePatchSchema);
export type FamilyContext = DrawContext<z.output<typeof familyData>,typeof fields,FamilyDraft,z.output<typeof edits>>;
export const module = route({
  key:"family",name:"Family",needs:"host",optionalTarget:"document",host:"./host.ts",
  directory:{label:"Family Foundry",exposure:"Main",group:"Build / audit families",icon:"Boxes",
    runtimeNeed:"Revit for capture and apply",summary:"Inspect saved family profiles, edit cells and review PDF evidence",
    aliases:["rfa","author","build","capture","matrix"],listed:true,satellites:[],resume:"document",surfaces:{web:"full",pwa:"full",tray:false}},
  core:loaded,fields,
  panes:{workspace:{title:"Family",purpose:"Review the family and its cut-sheet evidence",read:loaded,draw:draw(()=>import("./mount"),"FamilyBody")}},
  edits:{work:familyDraftRouteState,value:"familyWork",owners:{},input:edits,patches:input=>input,
    history:z.object({label:z.string()}),describe:history=>({label:history.label})},
  commands:{
    read:{...queryAction(familyQueries["family.read"]),label:"Read family",input:({work})=>({readId:crypto.randomUUID(),expectedRevision:work!.revision})},
    saved:{...queryAction(familyQueries["family.saved"]),label:"Read saved family",input:(_context,supplied)=>supplied},
    open:{...queryAction({key:"family.open-member",input:commands["family.observe"].input,run:async(input,context)=>actionResult(await runSemanticAction("family.observe",input,context.target,context.work))}),label:"Open member",input:(_context,supplied)=>supplied},
    attach:{...sessionCommand("family.attach-spec"),label:"Attach PDF",input:(_context,supplied)=>supplied},
    capture:{...sessionCommand("family.capture"),label:"Save family to pod",input:({page,value})=>({pod:page.pod,
      ...(value.familyWork.reading?{spec:settingsCandidate(value.familyWork.reading,value.familyWork.cells)}:{})})},
    build:{...command("family.build"),label:"Build .rfa",present:()=>({sentence:"Build the staged saved family member",rows:[]})},
    apply:{...command("family.apply"),label:"Apply family",present:result=>presentFamilyPlan(result)},
  },
  layout:{kind:"pane",id:"workspace"},
});
