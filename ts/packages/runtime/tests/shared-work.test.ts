import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, draftCellSchema, type RouteStateSpec } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { convertLegacyWork } from "../src/work-cutover.ts";

test("connected workspace shares edits, stamps either writer and preserves a revision fence", async () => {
  const schema = z.object({cells:z.record(z.string(),draftCellSchema(z.number())).default({}),basis:z.unknown().optional()});
  const spec: RouteStateSpec<typeof schema> = {route:"shared",title:"Shared",description:"Shared",schema,commands:{}};
  const rows = new Map<string,unknown>();
  const workspace = new RouteWorkspace({registrations:[{spec,handlers:{}}],store:{getState:async ({targetKey})=>rows.get(targetKey),setState:async ({targetKey,value})=>{rows.set(targetKey,value);}}});
  const key=bindWork("shared",null);
  expect(await workspace.apply(key,"shared","human",[{path:["cells","width","edit"],value:{value:200}}],0)).toMatchObject({ok:true,revision:1});
  expect(await workspace.apply(key,"shared","agent",[{path:["cells","width","edit"],value:{value:250,by:"human",base:0}}],1)).toMatchObject({ok:true,revision:2});
  expect((await workspace.read(key,"shared"))?.doc).toMatchObject({cells:{width:{edit:{value:250,by:"pea",base:1}}}});
  expect(await workspace.apply(key,"shared","human",[{path:["cells","width","edit"],value:{value:300}}],1)).toMatchObject({ok:false,code:"stale_revision"});
  expect(await workspace.apply(key,"shared","agent",[{path:["basis"],value:{forged:true}}],2)).toMatchObject({ok:false});
  expect(await workspace.publish(key,"shared",[{path:["basis"],value:{capture:"verified"}}],2)).toMatchObject({ok:true});
});

test("explicit conversion preserves revision/evidence and never invents historical provenance", () => {
  const old={version:1,revision:19,doc:{cells:{width:{staged:{value:200},proposal:{value:250,note:"source page 2"}}},basis:{captureId:"evidence"}}};
  const converted=convertLegacyWork(old,"family");
  expect(converted).toEqual({version:1,revision:19,doc:{cells:{width:{edit:{value:200,by:"unknown",at:null,base:null},suggestion:{value:250,note:"source page 2",by:"unknown",at:null,base:null}}},basis:{captureId:"evidence"}}});
  expect(old.doc.cells.width.staged.value).toBe(200);
  expect(()=>convertLegacyWork({version:1,revision:1,doc:{cells:{width:{staged:{value:1},edit:{value:2}}}}},"family")).toThrow("both old and shared");
});

test("conversion treats user JSON and evidence as opaque and supports cells named edit",()=>{
  const value={proposal:{value:1},staged:{value:2},edit:{value:3}};
  const old={version:1,revision:3,doc:{fields:{edit:{staged:{value}}},basis:{evidence:value}}};
  const next=convertLegacyWork(old,"pods") as typeof old & {doc:{fields:{edit:{edit:{value:unknown}}}}};
  expect(next.doc.fields.edit.edit.value).toEqual(value);
  expect(next.doc.basis).toEqual(old.doc.basis);
});
