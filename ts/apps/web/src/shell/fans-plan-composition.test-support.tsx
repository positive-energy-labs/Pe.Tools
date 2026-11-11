// @vitest-environment jsdom
import { stableFanKey } from "../ducts/sheet/model";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { surfaceReadiness } from "../route/readiness.test.fixture";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { Context, Effect, Layer, Queue, Option } from "effect";
import { expect, vi } from "vite-plus/test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRootRoute, createRouter, createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { openRecordingWriter, nativeCatalogIdentity } from "../../../host/src/native-recording";
import { HostInputContext } from "../../../host/src/input-context";
import { writeFileSync } from "node:fs";
import { HostNativeRead } from "../../../../packages/host-internal/src/native-read.ts";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import rosterCapture from "../../../../packages/host-contracts/src/fixtures/k2-roster.json";
import walkCapture from "../../../../packages/ducts-domain/src/sheet/fixtures/muas-local-20261102.json";
import { hostOwnership } from "../../../host/src/host-ownership";
import { HostDocumentMarks } from "../../../host/src/document-marks";
import { HostSessionInventory } from "../../../host/src/session-inventory";
import { DuctFiles } from "../../../host/src/ducts-files";
import { RevitBridge, RevitBridgeLive } from "../../../host/src/bridge";
import { SdkSession } from "../../../host/src/sdk-session";
import { ReadOwner } from "../../../host/src/builtin-inputs";
import { makeCallRoute } from "../../../host/src/call-route";
import { sdkSessions } from "../../../host/tests/native-receipt-fixture";
import { bootHost } from "../../../host/tests/real-server";
import { connectTestBridge } from "../../../host/tests/bridge-fixture";
import { admittedReceiptStamps } from "../../../host/src/receipt-export";
import { canonicalRouteInput, workFingerprintSchema, actionStatusSchema } from "@pe/agent-contracts";
import "../ducts/sheet/mount";
import { TypedShell } from "./typed-shell";
import { module as fans } from "../fans/route";
import { builtins } from "../route/builtins.neutral";
import { peReadings, bindActionReadings } from "../host/resource-stream";

const trace = vi.hoisted(()=>({gates:[] as any[],tokens:[] as any[],samples:[] as any[],stops:[] as any[],mounts:[] as any[],submit:vi.fn(),http:[] as any[],fetch:vi.fn(),base:"",target:null as any,holdPlan:()=>Promise.resolve()}));
// These Work journeys do not import Pods; bootstrap otherwise outlives the isolated host's home.
vi.mock("../../../host/src/installed-pods",async actual=>({
 ...await actual<typeof import("../../../host/src/installed-pods")>(),importShippedPods:async()=>({shippedRoot:null,outcomes:[]}),
}));
// Command steps reach Revit through `nativeStep`; hold Plan after its native answer settles.
vi.mock("../../../host/src/command-executor",async actual=>{
 const real=await actual<typeof import("../../../host/src/command-executor")>();
 const {Effect}=await import("effect");
 return {...real,nativeStep:(...args:Parameters<typeof real.nativeStep>)=>real.nativeStep(...args).pipe(
   Effect.tap(()=>args[2]==="ducts.apply.plan"?Effect.promise(()=>trace.holdPlan()):Effect.void))};
});
vi.mock("../host/runtime",()=>({hostFetch:trace.fetch,runtimeStreamUrl:(url:string)=>new URL(url,trace.base).toString()}));
vi.mock("../../../host/src/session-route",async actual=>{const real=await actual<any>();const {Effect}=await import("effect");const {sdkSessions}=await import("../../../host/tests/native-receipt-fixture");return {...real,runPeRevitCli:(args:any)=>Effect.promise(()=>sdkSessions(args))};});
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async actual => {const real=await actual<any>(); trace.submit.mockImplementation(async(...args:any[])=>{const row=await real.submitAction(...args);((trace as any).results??=[]).push(row);return row;}); return {...real,submitAction:trace.submit};});
vi.mock("../../../../packages/runtime/src/route-scope-gate",async actual=>{
 const original=await actual<any>();
 return {...original,createRouteScopeGate(options:any){const gate=original.createRouteScopeGate(options);trace.gates.push({gate,options});
 const invocation=gate.invocation;gate.invocation=(...args:any[])=>{const result=invocation(...args);if(result.ok&&args[0].channel.startsWith("plan:"))trace.tokens.push({token:result.value,gate});return result;};return gate;}};
});
vi.mock("./typed-mount",async actual=>{
 const original=await actual<any>();
 return {...original,mountTypedRoute(...args:any[]){const mount=original.mountTypedRoute(...args);trace.mounts.push(mount);mount.subscribe(()=>{const plan=trace.tokens.at(-1),state=plan?.gate.read();trace.samples.push({page:mount.page.read(),work:JSON.stringify(Object.keys(mount.spec.edits.owners).map((id:string)=>{const o=mount.owner(id);return[id,o.ready,o.handle];})),core:mount.value().current?mount.value().hash:"unavailable",plan:plan?{current:plan.gate.current(plan.token),samePageEpoch:plan.token.pageEpoch===state?.pageEpoch,pageRevision:state?.pageRevision,workRevision:state?.work?.revision}:null});});return mount;}};
});
const ambient = <S,I>(tag:Context.Key<S,I>)=>Layer.effect(tag,Effect.serviceOption(tag).pipe(Effect.map(Option.getOrThrow)));

export async function fansPlanJourney(journey: "watched publications" | "external Fans edit") {
 let mode:"recording"|"batched"="recording";
 for (const rows of [trace.gates,trace.tokens,trace.samples,trace.stops,trace.mounts,trace.http]) rows.length=0;
 trace.submit.mockClear(); (trace as any).results=[]; (trace as any).readEvents=[]; (trace as any).republication=null; (trace as any).settlements=[];
 const originalFetch=globalThis.fetch;
 const streams=new Set<any>();
 const requests:any[]=[];
 const workFrames:any[]=[];
 const releasePlan=Promise.withResolvers<void>(); let planPending=false;
 // Pause command delivery after native settlement; the watched read also needs the serialized native queue.
 trace.holdPlan=()=>{if(mode!=="recording")return Promise.resolve();planPending=true;return releasePlan.promise;};
 let bridge:any;
 const roster=nativeResponseSchema("ducts.snapshot.roster").parse(rosterCapture);
 const walk=nativeResponseSchema("ducts.snapshot.walk").parse(walkCapture);
 const muas=elementSubject({uniqueId:walk.nodes.find(n=>n.id===14577391)!.uniqueId!});
 const tables=nativeResponseSchema("ducts.tables").parse({folder:"fixture",tables:{},missing:[],unsupported:{}});
 const native=Layer.effect(HostNativeRead,Effect.gen(function*(){
   bridge=yield* connectTestBridge(); trace.target=bridge.target;
   yield* Effect.forkScoped(Effect.forever(Queue.take(bridge.outgoing).pipe(Effect.flatMap((frame:any)=>{
     const request=frame.request;if(!request)return Effect.void;
     requests.push(request.operationKey);
     const value=request.operationKey==="ducts.snapshot.roster"?roster:request.operationKey==="ducts.snapshot.walk"?walk:request.operationKey==="ducts.tables"?tables:request.operationKey==="ducts.apply.plan"?(()=>{
       const input=JSON.parse(request.payloadJson);
       // Same equipment-flow preview shape as host/tests/fans-native.fixture.ts; before comes from the captured walk.
       const writes=(input.equipmentFlows??[]).map((row:{id:number;cfm:number})=>({
         id:row.id,kind:"equipment-flow",outcome:"planned",
         before:`${walk.nodes.find(node=>node.id===row.id)!.facts.find(fact=>fact.key==="fanFlow")!.value} cfm`,
         after:`${row.cfm} cfm`,reason:null,
       }));
       return {previewOnly:true,writes,counts:{planned:writes.length,written:0,refused:0,unchanged:0},systemsAfter:[],storeRevision:0};
     })():request.operationKey==="revit.catalog.field-options"?{descriptor:{key:JSON.parse(request.payloadJson).key,mode:"Suggestion",allowsCustomValue:true,dependsOn:[],requiredRuntimeMode:"LiveDocument"},items:[],result:{kind:"Success",message:""}}:{};
     const reply=Queue.offer(bridge.incoming,JSON.stringify({kind:"Response",response:{requestId:request.requestId,openDocumentId:request.openDocumentId,ok:true,statusCode:200,payloadJson:JSON.stringify(value),metrics:{requestBytes:0,responseBytes:0,revitExecutionMs:0,roundTripMs:0,serializationMs:0}}}));
     return reply;
   }))));
   return yield* HostNativeRead;
 })).pipe(Layer.provide(ambient(HostNativeRead)),Layer.provide(ambient(RevitBridge)));
 const testRoot=process.env.PE_TEST_HOME_ROOT;
 if(!testRoot) throw Error("Fans journeys require the isolated test home");
 const dir=await mkdtemp(join(testRoot,"pe-f05-bisect-"));
 const stamp=admittedReceiptStamps().host!;
 const captureStore=await Effect.runPromise(openRecordingWriter(dir,{build:JSON.stringify({version:stamp.version,build:stamp.build,commit:stamp.commit}),catalog:nativeCatalogIdentity()},{maxBytes:256*1024*1024,maxTakings:10000}));
 const inputs=await Effect.runPromise(HostInputContext.pipe(Effect.provide(HostInputContext.layer({kind:"live",captureStore}))));
 const writer=inputs.lane.kind==="live"?inputs.lane.captureStore:undefined;
 if(writer){const stop=writer.capture.stop;vi.spyOn(writer.capture,"stop").mockImplementation((at,reason,source)=>{trace.stops.push({at,reason,stack:new Error().stack});return stop(at,reason,source);});}
 const host=await bootHost({inputs,reads:{live:{marks:ambient(HostDocumentMarks),inventory:HostSessionInventory.layer.pipe(Layer.provide(Layer.mergeAll(ambient(RevitBridge),ambient(SdkSession)))),files:DuctFiles.layer(),native}},revitCompositionFactory:()=>({provider:RevitBridgeLive,routes:Layer.unwrap(Effect.gen(function*(){const reads=yield* ReadOwner;return yield* makeCallRoute(undefined,{workspace:reads.work.workspace,sdk:sdkSessions,workReads:reads.work.reads},{pointers:reads.work.pointers,retainedRead:reads.retainedCall,nativeBody:reads.nativeBody});})).pipe(Layer.provide(native))})});
 trace.base=host.base;
 const subscriptionChanges:any[]=[];
 const forward=async(url:any,init:any={})=>{
   const headers=new Headers(init.headers);headers.set("x-pe-context",host.terminal);headers.set(HOST_RUNTIME_SERVICE_HEADER,hostOwnership.serviceName);
   const target=new URL(typeof url==="string"?url:url.url??url.href,host.base);if(typeof init.body==="string"){const body=JSON.parse(init.body);if(body.add&&body.remove)subscriptionChanges.push(body);}const response=await originalFetch(`${host.base}${target.pathname}${target.search}`,{...init,headers});if(target.pathname==="/pe/reads/value"||target.pathname.includes("sheet")||target.pathname.includes("actions")||target.pathname.includes("history")||target.pathname.includes("route-view")||target.pathname.includes("route-state")||target.pathname.includes("work"))trace.http.push({url:target.pathname,method:init.method??"GET",request:typeof init.body==="string"?JSON.parse(init.body):undefined,status:response.status,body:await response.clone().json().catch(()=>null)});return response;
 };
 trace.fetch.mockImplementation(forward);vi.stubGlobal("fetch",forward);
 const heldReceipts:string[]=[];
 const receiptBatch:any[]=[];
 let batchReleased=false;
 let previousPlan:string|undefined;
 const readyAfterBatch:string[]=[];
 class Stream {
   onopen:any;onmessage:any;onerror:any;controller=new AbortController();
   keys=new Set<string>();
   constructor(readonly url:string){streams.add(this);void this.start(url);}
   deliver(data:string){
     const frame=JSON.parse(data);
     if(frame.value?.handle?.key?.route === "ducts") workFrames.push(frame);
     if(!frame.kind&&typeof frame.generation==="number") (trace as any).readEvents.push({url:this.url,...frame});
     this.keys.add(frame.key);
     if(mode==="batched"&&!batchReleased&&trace.tokens.length && (frame.value?.kind==="receipt"||frame.value?.kind==="ready"&&frame.value.receipts)){
       heldReceipts.push(data);receiptBatch.push({kind:"held",key:frame.key,cursor:frame.value.cursor??frame.value.receipts.through,state:frame.value.receipt?.state??frame.value.receipts.rows.at(-1)?.state});return;
     }
     if(Array.isArray(frame.value)&&frame.value.some((row:any)=>row.key==="sheet.plan"&&row.id!==previousPlan&&row.state==="succeeded")){
       batchReleased=true;
       receiptBatch.push({kind:"flush",count:heldReceipts.length});
       for(const held of heldReceipts.splice(0))this.onmessage?.({data:held});
     }
     if(batchReleased&&frame.value?.kind==="ready"&&frame.value.receipts)readyAfterBatch.push(frame.key);
     this.onmessage?.({data});
   }
   async start(url:string){try{const response=await forward(url,{signal:this.controller.signal});if(!response.ok)throw Error(await response.text());this.onopen?.({});const reader=response.body!.getReader();let buffer="";while(!this.controller.signal.aborted){const chunk=await reader.read();if(chunk.done)break;buffer+=new TextDecoder().decode(chunk.value);let end;while((end=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split("\n").filter(s=>s.startsWith("data:")).map(s=>s.slice(5).trimStart()).join("\n");if(data)this.deliver(data);}}}catch(error){if(!this.controller.signal.aborted)this.onerror?.(error);}}
   close(){this.controller.abort();streams.delete(this);}
 }
 vi.stubGlobal("ResizeObserver",class {observe(){} unobserve(){} disconnect(){}});
 vi.stubGlobal("EventSource",Stream);
 const unbind=bindActionReadings();
 const dirties:any[]=[];const originalDirty=peReadings.dirty.bind(peReadings);
 peReadings.dirty=(request:any,scope?:"connection"|"subject")=>{dirties.push({request,scope});originalDirty(request,scope);};
 let search=new URLSearchParams({target:JSON.stringify({kind:"open",ref:trace.target}),thread:"f05-probe",fan:JSON.stringify({kind:"ids",ids:[stableFanKey({ uniqueId: walk.nodes.find(n=>n.id===14577391)!.uniqueId!, portIndex: 2 })]})});
 const listeners=new Set<()=>void>();
 const address={read:()=>new URLSearchParams(search),write:(next:URLSearchParams)=>{search=new URLSearchParams(next);listeners.forEach(f=>f());},subscribe:(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f);};}};
 const root=createRootRoute({validateSearch:(s:Record<string,unknown>)=>s,component:()=> <TypedShell module={fans} fingerprint={workFingerprintSchema.parse(`builtin-closure:${builtins.fans.closure.fingerprint}`)} address={address}/>});
 const router=createRouter({routeTree:root,history:createMemoryHistory({initialEntries:["/?thread=f05-probe"]})});
 let before:any,after:any,firstSettlement:any;
 const sample=()=>{const {gate,options}=trace.gates.at(-1);const state=gate.read();const mount=trace.mounts.at(-1);return {pageEpoch:state.pageEpoch,pageRevision:state.pageRevision,workRevision:state.work?.revision??null,dependencies:options.dependencies(),workSignature:canonicalRouteInput(Object.keys(mount.spec.edits.owners).map(id=>{const o=mount.owner(id);return[id,o.ready,o.handle];}))};};
 try{
   render(<RouterProvider router={router}/>);
   await vi.waitFor(()=>expect(trace.mounts.at(-1)?.owner()?.scope.key.binding).toBe("address"),{timeout:20000});
   const mount=trace.mounts.at(-1);
   await mount.whenReady();
   expect(mount.startAction()).toBeTruthy();
   if(journey === "external Fans edit") {
     const edited = await act(async()=>forward(peRouteUrl("work.apply", {params:{route:"fans"},query:{open:`${trace.target.session}/${trace.target.openId}`}}, host.base), {
       method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
         kind:"apply",expectedRevision:0,press:"outside-mount",label:"Stage fan from outside the page",
         patches:[
           {path:["writeIntent","edit"],value:{value:{walk:{unitId:14577391,portIndex:2}}}},
           {path:["equipmentFlows",muas],value:{edit:{value:{cfm:925}}}},
         ],
       }),
     }));
     expect(edited.status).toBe(200);
     expect(await edited.json()).toMatchObject({ok:true,revision:1,handle:{key:{route:"fans"},revision:1}});
     await screen.findByText(/^MUAS-1.*1 staged$/);
     await vi.waitFor(()=>expect(trace.mounts.at(-1).readiness().kind).not.toBe("pending"),{timeout:10000});
     expect(screen.getByRole("region",{name:"Situation"}).textContent).not.toContain("Start this Work");
     expect(screen.getByRole("region",{name:"Situation"}).textContent).not.toContain("Work is absent");
     expect(screen.getByRole("region",{name:"Situation"}).textContent).not.toContain("ducts");
     expect(screen.queryByRole("button",{name:"Start"})).toBeNull();
     // Ruling 2026-11-10 (no cross-route write): /fans opens no /ducts Work and draws no /ducts criterion.
     expect(workFrames).toEqual([]);
     const beforeEdit=await (await forward("/pe/navigation")).json();
     expect(beforeEdit.works.some((row:any)=>row.route==="ducts")).toBe(false);
     expect(screen.queryByLabelText("Velocity limit supply fpm")).toBeNull();
     await trace.mounts.at(-1).whenWritable();
     expect(screen.getByRole("region",{name:"Situation"}).textContent).not.toContain("Work is absent");
     fireEvent.click(screen.getByRole("button",{name:"plan Write to Revit"}));
     await vi.waitFor(()=>expect(planPending).toBe(true),{timeout:45000});
     releasePlan.resolve();
     await vi.waitFor(()=>expect((trace as any).results.at(-1)).toMatchObject({key:"sheet.plan",state:"succeeded"}),{timeout:45000});
     await screen.findByRole("button",{name:"Write to Revit"});
     expect((trace as any).results.at(-1).consumes.some((row:any)=>row.kind==="work" && row.probe.handle.key.route==="fans" && row.probe.handle.revision===1)).toBe(true);
     // Slice 6 seam (a): the recorded-point verbs open from the Timeline, the topbar's history door.
     fireEvent.click(screen.getByRole("button",{name:"Open the Timeline"}));
     fireEvent.click(await screen.findByRole("button",{name:"Capture point"}));
     await vi.waitFor(()=>expect(trace.http.find(row=>row.url==="/pe/history" && row.request?.kind==="captured")?.status).toBe(200),{timeout:10000});
     const point=trace.http.find(row=>row.url==="/pe/history" && row.request?.kind==="captured").body;
     const history=await (await forward(`/pe/history?at=${point.id}`)).json();
     expect(history.work.find((row:any)=>row.handle.key.route==="fans")).toMatchObject({revision:1});
     // The host's plan reads /ducts Work itself (a read, not a cross-route write): nothing on /fans moved it.
     expect(history.work.filter((row:any)=>row.handle.key.route==="ducts").every((row:any)=>row.revision===0)).toBe(true);
     expect(document.body.textContent).not.toContain("Work is absent");
     return;
   }
   for(const route of Object.keys(fans.spec.edits!.owners)){
     const owner=mount.owner(route);
     if(route === "fans") { expect(owner.absent).toBe(true); expect(owner.handle).toBeNull(); }
     const id=crypto.randomUUID();
     const started=await forward("/actions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
       id,key:"work.start",target:{kind:"host"},input:{key:owner.scope.key,seed:owner.config.state.schema.parse({})},
     })});
     expect([200,202]).toContain(started.status);
     const settled=await forward(`/actions?id=${id}&wait=25000`);
     expect((await settled.json())[0]).toMatchObject({id,key:"work.start",state:"succeeded"});
     await mount.whenReady();
   }
   expect(screen.queryByRole("button",{name:"Start"})).toBeNull();
   expect(screen.getByRole("region",{name:"Situation"}).textContent).not.toContain("Work is absent");
   await screen.findByRole("button",{name:"plan Write to Revit"});
   await mount.whenWritable();
   fireEvent.click(await screen.findByRole("button",{name:"None"},{timeout:20000}));
   fireEvent.click(await screen.findByRole("option",{name:/MUAS-1.*0 staged/}));
   expect((await surfaceReadiness()).getAttribute("data-readiness")).toBe("ready");
   await act(async()=>{
     const failure=await mount.draw("sheet-inputs",(ctx:any)=>ctx.cells.edit({equipmentFlows:{[muas]:{cfm:925}}},{label:"Stage MUAS-1 airflow"}));
     if(failure) throw Error(failure.message);
   });
   // The shell draws no "Refresh Fans" button since 852a46a5; the route's refresh door is the mount's.
   await act(async()=>trace.mounts.at(-1).refresh());
   await mount.whenWritable();
   for(mode of ["recording","batched"] as const){
     if(mode==="batched"){batchReleased=false;receiptBatch.length=0;heldReceipts.length=0;readyAfterBatch.length=0;}
     before=sample();
     const watched=trace.http.find(row=>row.url==="/pe/reads/value"&&row.request?.read==="fans.sheet"&&row.body?.value?.evaluation===before.dependencies["fans.sheet"]);
     const watches=(row:any)=>new URL(row.url,host.base).searchParams.get("subscription")===watched.request.subscription;
     if(mode==="recording") await vi.waitFor(()=>expect((trace as any).readEvents.some(watches)).toBe(true),{timeout:10000});
     fireEvent.click(screen.getByRole("button",{name:"plan Write to Revit"}));
     if(mode==="recording"){
       await vi.waitFor(()=>expect(planPending).toBe(true),{timeout:45000});
       const eventStart=(trace as any).readEvents.length;
       try {
         // A real watched-slot republication while the Plan command is pending; no input changes.
         const response=await forward("/pe/reads/value",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(watched.request)});
         const publication=await response.json(); (trace as any).republication=publication;
         expect.soft(publication.state,"Recording must not refuse the watched republication").toBe("current");
         await vi.waitFor(()=>expect((trace as any).readEvents.slice(eventStart).some(watches)).toBe(true),{timeout:10000});
         if(publication.state!=="current") await vi.waitFor(()=>expect(trace.mounts.at(-1).value().current).toBe(false),{timeout:5000});
       } finally {releasePlan.resolve();}
     }
     await vi.waitFor(()=>{expect((trace as any).results).toHaveLength(mode==="recording"?1:2);expect((trace as any).results.at(-1).state).toBe("succeeded");},{timeout:45000});
     expect.soft(trace.stops,"Plan's own Work reads must remain recordable").toEqual([]);
     await screen.findByRole("button",{name:"Write to Revit"},{timeout:5000});
     after=sample();
     const settlement={mode,inspectable:true,problem:trace.mounts.at(-1)?.reviewProblem("losses"),before,after};
     firstSettlement??=settlement; (trace as any).settlements.push(settlement);
     expect(after.pageEpoch).toBe(before.pageEpoch);expect(after).toEqual(before);
     const plan=trace.tokens.at(-1);expect(plan.gate.current(plan.token)).toBe(true);
     expect(document.body.textContent).not.toContain("Review is stale");
     if(mode==="recording"){
       previousPlan=(trace as any).results.at(-1).id;
       await act(async()=>trace.mounts.at(-1).cancel("losses"));
       await screen.findByRole("button",{name:"plan Write to Revit"});
     }
   }
   const commandReads=[];
   for(const id of captureStore.readSets.ids()){
     const record=await Effect.runPromise(captureStore.readSets.get(id));
     if(record.recipe.key==="command.work.view"&&(record.recipe.input as any).command==="sheet.plan") commandReads.push(record);
   }
   expect(new Set(commandReads.map(record=>(record.recipe.input as any).route))).toEqual(new Set(["ducts","fans"]));
   expect(commandReads.every(record=>record.state==="complete"&&record.inputs.some(input=>input.input.kind==="work"&&input.input.view==="view"))).toBe(true);
   (trace as any).commandReads=commandReads;
   expect(trace.submit).toHaveBeenCalledTimes(2);
   expect(dirties).toEqual([]);
   const receiptKey=receiptBatch.find(row=>row.kind==="held").key;
   expect(receiptBatch.filter(row=>row.kind==="held"&&row.key===receiptKey).length).toBeGreaterThan(1);
   const stream=[...streams].find(stream=>stream.keys.has(receiptKey));
   const skippedCursor=receiptBatch.filter(row=>row.kind==="held"&&row.key===receiptKey).at(-1).cursor+2;
   for(const gap of [{kind:"gap",key:receiptKey,dropped:1},
     {kind:"event",key:receiptKey,value:{kind:"receipt",cursor:skippedCursor,receipt:actionStatusSchema.parse((trace as any).results.at(-1))}}]){
   const sampleStart=trace.samples.length, updateStart=subscriptionChanges.length, streamCount=streams.size,dirtyStart=dirties.length;
   const readyCount=readyAfterBatch.filter(key=>key===receiptKey).length;
   await act(async()=>stream.onmessage({data:JSON.stringify(gap)}));
   await vi.waitFor(()=>expect(readyAfterBatch.filter(key=>key===receiptKey).length).toBeGreaterThan(readyCount),{timeout:10000});
   expect(dirties.slice(dirtyStart)).toEqual([{request:JSON.parse(receiptKey),scope:"subject"}]);
   expect(streams.size).toBe(streamCount);
   const changes=subscriptionChanges.slice(updateStart);
   expect(changes.some(change=>change.remove.includes(receiptKey))).toBe(true);
   expect(changes.some(change=>change.add.some((request:any)=>canonicalRouteInput(request)===receiptKey))).toBe(true);
   expect(changes.flatMap(change=>[...change.add,...change.remove.map((key:string)=>JSON.parse(key))]).every(request=>request.kind==="receipts")).toBe(true);
   expect(trace.samples.slice(sampleStart).every(sample=>JSON.parse(sample.work).every((owner:any)=>owner[1]))).toBe(true);
   }
   fireEvent.click(screen.getByRole("button",{name:/^MUAS-1.*1 staged$/}));
   fireEvent.click(await screen.findByRole("option",{name:/^None/}));
   await vi.waitFor(()=>expect(trace.mounts.at(-1).owner().handle.revision).toBe(4),{timeout:20000});
   await expect(trace.mounts.at(-1).run("losses",true)).rejects.toThrow("Review is stale; prepare it again");
   expect(trace.submit).toHaveBeenCalledTimes(2);
 }catch(error){
   if(process.env.PE_F05_EVIDENCE)writeFileSync(`${process.env.PE_F05_EVIDENCE}.failure`,String((error as Error).stack??error));
   throw error;
 }finally{
   releasePlan.resolve();
   firstSettlement??={inspectable:!!screen.queryByRole("button",{name:"Write to Revit"}),problem:trace.mounts.at(-1)?.reviewProblem("losses"),before,after:trace.mounts.length?sample():undefined};
   if(process.env.PE_F05_EVIDENCE)writeFileSync(process.env.PE_F05_EVIDENCE,JSON.stringify({mode,workFrames,firstSettlement,settlements:(trace as any).settlements,commandReads:(trace as any).commandReads,readEvents:(trace as any).readEvents,republication:(trace as any).republication,submits:trace.submit.mock.calls.length,results:(trace as any).results,receiptBatch,dirties,subscriptionChanges,http:trace.http,before,after,samples:trace.samples,stops:trace.stops,plans:trace.tokens.map(({token,gate})=>({id:token.id,current:gate.current(token),samePageEpoch:token.pageEpoch===gate.read()?.pageEpoch})),requests,body:document.body.textContent,problem:trace.mounts.at(-1)?.reviewProblem("losses")},null,2));
   cleanup();unbind();peReadings.dirty=originalDirty;peReadings.close();for(const stream of streams)stream.close();vi.unstubAllGlobals();await host.close();
   // A capture write can still be landing after close; its retry keeps a cleanup error from replacing the real assertion.
   await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}
