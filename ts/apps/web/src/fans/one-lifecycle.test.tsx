// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import { historySnapshotSchema } from "../shell/history";
import { mountTypedRoute } from "../shell/typed-mount";
import type { ReadingContext } from "../shell/source-contract";
import { createWitness } from "./cutover.test-support";

test("typed panes share declared Values; recorded Fans and Ducts use frozen Work and refuse writes", async () => {
  const closes: (() => void)[] = [];
  const stop = vi.fn();
  const open = vi.fn((_ctx: ReadingContext) => stop);
  const document = address("C:/Jobs/History.rvt");
  const f = await createWitness(closes, new Map(), { "fans.sheet": { kind: "use", open } }, {address:document,open:{session:"fixture",openId:"fans"}});
  try {
    for (const pane of Object.keys(f.typed.spec.panes)) f.typed.draw(pane);
    expect(open).toHaveBeenCalledTimes(2);
    expect(stop).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.typed.owner()?.ready).toBe(true));
    const input = f.places.get("fans")!;
    for (const route of [f.admitted.presenter,f.admitted.owner]) {
    const live = route.data.key === "fans" ? f.typed : (f.owner as unknown as {native:typeof f.typed}).native;
    const recordedPage = {...live.page.read(),contextRadiusFt:23};
    const history = historySnapshotSchema.parse({
      point: { id:crypto.randomUUID(),document,at:Date.now(),takingRange:{start:0,end:0},reason:{kind:"captured"},
        history:{address:document,target:{session:"fixture",openId:"fans"},poses:[{instance:"recorded",route:route.data.key,href:`/${route.data.key}`,page:recordedPage}],publications:[]} },
      // Each route records the Work it owns (/fans owns no /ducts Work, ruling 2026-11-10).
      work: Object.keys(live.spec.edits!.owners).map(id => { const owner=live.owner(id)!;return {handle:owner.handle,revision:owner.handle!.revision,doc:owner.doc}; }),
    });
    const recorded = mountTypedRoute(route.typed,{...input,history,readOnly:true,publicationInstance:"recorded",memory:()=>recordedPage},route.workFingerprint,{sources:Object.fromEntries([route.typed.spec.core,...Object.values(route.typed.spec.reads ?? {})].map(read=>[read!.key,{kind:"use",open}]))});
    try {
      expect(recorded.owner()?.ready).toBe(true);
      expect(recorded.page.read().contextRadiusFt).toBe(23);
      expect(recorded.workBasis()).toBeNull();
      expect(recorded.journalRefusal()).toBe("needs live Revit");
      expect(open.mock.calls.at(-1)![0]).toMatchObject({historyPoint:history.point.id,historyPose:{instance:"recorded",route:route.data.key}});
      await expect(recorded.run("losses")).rejects.toThrow("needs live Revit");
    } finally { recorded.dispose(); expect(recorded.history.entries).toEqual([]); }
    }

  } finally { closes.reverse().forEach(close => close()); }
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(7));
});


test("optional Work, explicit demand and invocation arguments share one typed scope", async () => {
  const {z}=await import("zod");
  const {route,field}=await import("../route/typed-route");
  const {sessionCommand,queryAction}=await import("../route/typed-actions");
  const {module:reference}=await import("./route");
  const {hostRead}=await import("../route/host-read");
  const {valueRead,workFingerprintSchema}=await import("@pe/agent-contracts");
  const source=vi.fn();
  const read=hostRead({...valueRead("probe.value",z.object({}),z.object({answer:z.number()})),demand:"explicit"});
  const declaration={key:"wave4-probe",address:"/",name:"Probe",needs:"host" as const,directory:reference.data.directory,
    fields:{member:field(z.string(),"","query")},core:{...read,args:()=>({})},
    panes:{main:{title:"Probe",purpose:"Scope falsifier",read,draw:(ctx:unknown)=>ctx}},layout:{kind:"pane" as const,id:"main"}};
  const calls:unknown[]=[],queries:unknown[]=[];
  const door={
    lifetime:"subscription",receipts:()=>({subscribe:()=>()=>{}}),
    open:(scope:import("@pe/agent-contracts").WorkScope)=>{calls.push(scope.key);return {subscribe:(deliver:(state:unknown)=>void)=>{
      deliver({kind:"ready",snapshot:{handle:{key:scope.key,revision:7},revision:7,value:{note:{edit:{value:scope.key.work}}}},history:{acks:[],from:0}});
      return ()=>{};
    }};},
    submit:vi.fn((input:unknown)=>({accepted:{subscribe:(deliver:(state:unknown)=>void)=>{
      deliver({kind:"accepted-native",outcome:"committed",result:input,receiptId:"probe"});return ()=>{};
    }}})),
  } as unknown as import("@pe/agent-contracts").WorkJournalDoor;
  let search=new URLSearchParams();
  const input={address:{read:()=>new URLSearchParams(search),write:(next:URLSearchParams)=>{search=new URLSearchParams(next);},subscribe:()=>()=>{}},
    fixture:null,target:{kind:"host" as const},work:{address:null,open:null},custody:{current:()=>true},memory:()=>({})};
  const fingerprint=workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const browser=mountTypedRoute(route({...declaration,needs:"browser",core:undefined,panes:{main:{title:"Probe",purpose:"Browser",draw:(ctx:unknown)=>ctx}}}),{...input,target:null},fingerprint,{work:door});
  try {expect(calls).toEqual([]);expect(browser.workBasis()).toBeNull();browser.page.query({member:"local"});expect(browser.page.read().member).toBe("local");}
  finally {browser.dispose();}
  search=new URLSearchParams();
  const module=route({...declaration,
    edits:{work:z.object({note:z.object({edit:z.object({value:z.string()}).optional()})}),key:page=>page.member||null,
      owners:{},input:z.string(),patches:()=>[],history:z.object({label:z.string()}),describe:(detail:{label:string})=>detail},
    commands:{start:{...sessionCommand("instances.start"),label:"Start"},echo:{...queryAction({key:"probe.echo",input:z.object({blob:z.string()}),
      run:async(args,context)=>{queries.push({args,context});return args;}}),label:"Echo"}},
  });
  const mounted=mountTypedRoute(module,input,fingerprint,{work:door,sources:{"probe.value":{kind:"use",open:source}}});
  try {
    const stop=mounted.subscribe(()=>{});mounted.page.query({member:"A"});
    expect(source).not.toHaveBeenCalled();expect(door.submit).not.toHaveBeenCalled();
    expect(calls.every(key=>(key as {work:string}).work === "A")).toBe(true);
    mounted.page.query({member:"B"});expect(mounted.owner()?.handle?.key).toMatchObject({binding:"workspace",work:"B"});
    mounted.refresh(module.spec.core);expect(source).toHaveBeenCalledOnce();
    await mounted.run("echo",false,{blob:"invocation only"});
    expect(queries).toEqual([{args:{blob:"invocation only"},context:{target:{kind:"host"},work:expect.objectContaining({key:expect.objectContaining({work:"B"}),revision:7})}}]);
    await mounted.run("start",false,{year:"2026",owner:"you",addins:"on"});expect(door.submit).toHaveBeenCalledOnce();
    expect(mounted.page.read()).toMatchObject({member:"B"});expect(search.has("blob")).toBe(false);
    mounted.page.query({member:""});expect(mounted.owner()).toBeUndefined();expect(mounted.workBasis()).toBeNull();stop();
  } finally {mounted.dispose();}
});


test("cell undo targets the exact owner press and leaves the other owner staged",async()=>{
  const {z}=await import("zod");
  const {draftCellSchema,workFingerprintSchema}=await import("@pe/agent-contracts");
  const {route}=await import("../route/typed-route");
  const {module:reference}=await import("./route");
  const {createFixtureWorkDoor}=await import("../shell/fixture-work-door");
  const schema=z.object({cells:z.record(z.string(),draftCellSchema(z.number())).default({})});
  const primary={route:"undo-a",title:"A",description:"Undo witness",schema};
  const secondary={...primary,route:"undo-b",title:"B"};
  const module=route({key:primary.route,name:"Undo",needs:"host",directory:reference.data.directory,fields:{},
    edits:{work:primary,owners:{"undo-b":{state:secondary}},input:z.never(),patches:()=>[],history:z.object({label:z.string()}),describe:(detail:{label:string})=>detail},
    panes:{main:{title:"Cells",purpose:"Undo falsifier",draw:(ctx:unknown)=>ctx}},layout:{kind:"pane",id:"main"}});
  const door=createFixtureWorkDoor(primary,schema.parse({}),{"undo-b":schema},{"undo-a":schema.parse({}),"undo-b":schema.parse({})},{"undo-b":"undo-b"});
  const mount=mountTypedRoute(module,{address:{read:()=>new URLSearchParams(),write:()=>{},subscribe:()=>()=>{}},fixture:null,
    target:{kind:"host"},work:{address:null,open:{session:"undo",openId:"cells"}},custody:{current:()=>true},memory:()=>({})},
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),{work:door});
  const ctx=()=>mount.draw("main") as import("../route/typed-route").DrawContext<unknown,{},import("zod").z.output<typeof schema>,never>;
  try {
    await vi.waitFor(()=>expect(ctx().cells.ready).toBe(true));
    expect(await ctx().cells.at(["cells","one"],"undo-a").stage(1,{label:"First owner"})).toBeNull();
    expect(await ctx().cells.at(["cells","two"],"undo-b").stage(2,{label:"Second owner"})).toBeNull();
    expect(await ctx().cells.at(["cells","one"],"undo-a").undo()).toBeNull();
    expect(mount.owner("undo-a")?.doc.cells.one?.edit).toBeFalsy();
    expect(mount.owner("undo-b")?.doc.cells.two.edit.value).toBe(2);
  } finally {mount.dispose();}
});
