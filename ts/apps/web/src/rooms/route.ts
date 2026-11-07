import { z } from "zod";
import { roomsRouteState,routeStatePatchSchema,valueRead,type RoomsRouteDocument } from "@pe/agent-contracts";
import { roomsAddress } from "../../../../packages/agent-contracts/src/routes/rooms";
import { route,field,command,type DrawContext } from "../route/typed-route";
import { hostRead } from "../route/host-read";
import { draw } from "../route/draw";
import { roomsArgs,roomsData } from "./value";
const address=roomsAddress.fields;
const fields={stage:field(address.stage.schema,"partition","pose","push"),view:field(address.view.schema,"","query","push"),
  layers:field(address.layers.schema,[],"pose"),show:field(address.show.schema,"all","query"),viewport:field(address.viewport.schema,null,"pose"),picked:field(z.array(z.string()),[],"pose")};
const loaded={...hostRead(valueRead("rooms.workspace",roomsArgs,roomsData)),args:(page:{view:string})=>({view:page.view})};
const edits=z.array(routeStatePatchSchema);
export type RoomsContext=DrawContext<z.output<typeof roomsData>,typeof fields,RoomsRouteDocument,z.output<typeof edits>>;
export const module=route({key:"rooms",name:"Rooms",needs:"project",host:"./host.ts",
 directory:{label:"Manual J",exposure:"Preview",group:"Calculate loads & airflow",icon:"LayoutDashboard",runtimeNeed:"Revit for room plans and writes",summary:"Inspect room regions, stage loads and review anchored feedback",aliases:["manual","j","loads","regions"],listed:true,satellites:[],resume:"document",surfaces:{web:"full",pwa:"full",tray:false}},
 core:loaded,fields,panes:{main:{title:"Rooms",purpose:"Choose a level and inspect its rooms",read:loaded,draw:draw(()=>import("./mount"),"RoomsBody")}},
 edits:{work:roomsRouteState,value:"roomsWork",owners:{},input:edits,patches:input=>input,history:z.object({label:z.string()}),describe:history=>({label:history.label})},
 commands:{partition:{...command("rooms.partition"),label:"Partition view",present:()=>({sentence:"Partition the staged plan view",rows:[]})},
  apply:{...command("rooms.write"),label:"Write room fields",present:()=>({sentence:"Write the staged room fields",rows:[]})},
  merge:{...command("rooms.merge"),label:"Merge rooms",present:()=>({sentence:"Merge the staged room selection",rows:[]})}},
 layout:{kind:"pane",id:"main"}});
