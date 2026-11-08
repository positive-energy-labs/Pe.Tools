// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { SceneMeshes } from "../scene/types";
import type { Scene3DProps } from "../scene/scene3d";
import { TestAttention } from "../test-attention";
import { makeAtomRegistry } from "../shell/owner";
import { mountTypedRoute } from "../shell/typed-mount";
import { route, localId } from "./typed-route";
import { module as fans } from "../fans/route";
import { PictureBody, RosterBody } from "../ducts/sheet/mount";
import { SubjectDoor, typedSubjectDoor } from "../shell/subject";
import { workFingerprintSchema } from "@pe/agent-contracts";
const io = vi.hoisted(() => ({ call: vi.fn(), orbit: null as Scene3DProps["orbit"] | null }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("../scene/artifact", () => ({ fetchSceneArtifact: async () => new ArrayBuffer(0) }));
vi.mock("../scene/psc1", () => ({
  SCENE_FORMAT: "space-scene-v2",
  decodeScene: () => ({
    meshes: new SceneMeshes(
      new Float32Array(),
      { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      [],
    ),
    metadata: {
      elements: [],
      stamp: { sources: [] },
      omittedElements: 0,
      unavailableElements: [],
      completeness: { complete: true },
    },
  }),
}));
// Capture, retention, status and ModelPicture are real; WebGL is the deterministic boundary.
vi.mock("../scene/scene3d", () => ({
  Scene3D: ({ meshes, readout, orbit }: Scene3DProps) => {
    io.orbit = orbit;
    return <div data-rendered={!!meshes}>{readout}</div>;
  },
}));


const observers = new Map<Element, ResizeObserverCallback>();
afterEach(() => { cleanup(); observers.clear(); io.call.mockReset(); vi.unstubAllGlobals(); });

test("JZ H04 typed Fans picture demands exact elements and reach, refuses document-only detail and replaces document authority", async () => {
  const { open, tree, resize, mounts, registry } = pictureJourney();
  try {
    const a = open("a");
    await waitFor(() => expect(a.value(), JSON.stringify(a.value())).toMatchObject({current:true}));
    const view = render(tree(a)); resize();
    await waitFor(() => expect(io.call).toHaveBeenCalled());
    expect(io.call.mock.calls.every(([, req]) => req.contextRepresentation === "overview"), "H04: mount acquires no detailed geometry").toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Read detailed" }));
    await waitFor(() => expect(io.call.mock.calls.some(([, req]) => req.contextRepresentation === "meshes")).toBe(true));
    const detail = io.call.mock.calls.find(([, req]) => req.contextRepresentation === "meshes")!;
    const sheet = (a.value().value as any).open;
    const layers = a.page.read().layers;
    const context = layers === "all" || layers.includes("context") || layers.includes("halo");
    const expected = [...new Set<number>([sheet.overview.fan.unitId, ...sheet.elements.walkedElementIds,
      ...(context ? sheet.elements.beyond.flatMap((unit: { elementIds: number[] }) => unit.elementIds) : []),
    ])].sort((x, y) => x - y);
    expect(detail[1].elementIds, "H04: detail names only the opened walk and declared neighbours").toEqual(expected);
    expect(detail[1]).toMatchObject({ contextPaddingFt: 10, focusOnly: false });
    expect(detail[2]).toMatchObject({ bridgeSessionId: "h04", openDocumentId: "a" });
    const b = open("b"); await waitFor(() => expect(b.value().current).toBe(true));
    view.rerender(tree(b)); resize();
    await waitFor(() => expect(detail[2].signal.aborted).toBe(true));
    const count = io.call.mock.calls.length;
    expect(io.call.mock.calls.filter(([, , options]) => options.openDocumentId === "b").every(([, req]) => req.contextRepresentation === "overview")).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Read detailed" }));
    await waitFor(() => expect(io.call.mock.calls.length).toBeGreaterThan(count));
    expect(io.call.mock.calls.at(-1)![2]).toMatchObject({ bridgeSessionId: "h04", openDocumentId: "b" });
    expect(io.call.mock.calls.at(-1)![1].contextRepresentation).toBe("meshes");
    const empty = open("empty", true); await waitFor(() => expect(empty.value().current).toBe(true));
    view.rerender(tree(empty)); resize();
    const before = io.call.mock.calls.length;
    expect(view.queryByRole("button", { name: "Read detailed" }), "H04: no element scope offers no detail action").toBeNull();
    await act(async () => {});
    expect(io.call.mock.calls.length, "H04: a document without elements never authorizes detail").toBe(before);
  } finally { cleanup(); mounts.forEach(m => m.dispose()); registry.dispose(); }
});

function pictureJourney() {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.set(element, this.callback); }
    unobserve(element: Element) { observers.delete(element); }
    disconnect() {}
  });
  io.call.mockImplementation(() => new Promise(() => {}));
  const spec = route({ ...fans.spec, edits: undefined });
  const registry = makeAtomRegistry();
  const stamp = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const mounts: ReturnType<typeof mountTypedRoute>[] = [];
  const open = (openId: string, empty = false) => {
    const mount = mountTypedRoute(spec, {
      target: { kind: "document", ref: { session: "h04", openId } }, fixture: null,
      work: { address: null, open: null },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      custody: { current: () => true }, memory: () => ({ viewport: { kind: "orbit", yaw: 225, elev: 32, zoom: 1, pivot: [0, 0, 0] } }),
    }, stamp, { sources: { "fans.sheet": { kind: "use", open(ctx, deliver) {
      const packet = structuredClone(fans.spec.core!.source.provide!("layout", ctx.args));
      const data = packet.value!.data as any;
      data.sheetSnapshot.sourceVersion = `h04-${openId}`;
      if (empty) { data.sheetSnapshot.nodes = []; data.sheetSnapshot.segments = []; data.open = null; data.opened = []; data.rows = []; data.fans.rows = []; }
      deliver({ kind: "complete", value: packet, revision: 1 });
    } } } });
    mounts.push(mount); mount.subscribe(() => {}); mount.page.subject({ kind: "ids", ids: [localId("ducts-fan", "9cb9f188-28aa-4094-8b76-785395cc35e1-00000001@2")] });
    return mount;
  };
  const tree = (mount: ReturnType<typeof open>) => <TestAttention registry={registry}>{mount.draw("sheet-picture", ctx => <PictureBody ctx={ctx as any} />) as React.ReactNode}</TestAttention>;
  const resize = () => act(() => { for (const [target, callback] of observers) callback([{ target, contentRect: { width: 640, height: 480 } } as ResizeObserverEntry], {} as ResizeObserver); });
  return { open, tree, resize, mounts, registry };
}

test("JM B03/B14/B18 named Fans roster and a live gesture survive typed Page projections", async () => {
  const { open, tree, resize, mounts, registry } = pictureJourney();
  try {
    const a = open("jm-pose");
    await waitFor(() => expect(a.value().current).toBe(true));
    const view = render(tree(a)); resize();
    await waitFor(() => expect(io.orbit?.read()).not.toBeNull());
    const orbit = io.orbit!;
    const pose: import("../scene/orbit").OrbitViewport = { kind: "orbit", yaw: 170, elev: 17, zoom: 2, pivot: [0, 0, 0] };
    const gesture = orbit.begin();
    const committed = a.page.read().viewport;
    act(() => orbit.preview(gesture, pose));
    expect(a.page.read().viewport, "B14: pointer preview does not publish Page or recompute route reads").toEqual(committed);
    view.rerender(tree(a)); resize();
    expect(io.orbit, "B18: equal typed Page projection retains the camera owner").toBe(orbit);
    expect(orbit.owns(gesture), "B18: resize does not interrupt an uncommitted gesture").toBe(true);
    expect(orbit.read(), "B18: resize and projection preserve the uncommitted pose").toEqual(pose);
    act(() => orbit.end(gesture));
    expect(a.page.read().viewport, "B18: gesture release commits the same pose into Page").toEqual(pose);
    const roster = render(<TestAttention registry={registry}><SubjectDoor value={typedSubjectDoor(a)}>
      {a.draw("sheet-roster", ctx => <RosterBody ctx={ctx as any} />) as React.ReactNode}
    </SubjectDoor></TestAttention>);
    expect(roster.getByRole("combobox", { name: "Search fans" }), "B03: Fans keeps its own named roster").toBeTruthy();
    expect(roster.queryByRole("button", { name: "Choose fan" }), "B03: a route roster has no duplicate picker").toBeNull();
    expect(roster.container.textContent, "B03: readable identity never prints encoded subject ids").not.toContain("9cb9f188-28aa-4094-8b76");
    fireEvent.click(roster.getByRole("button", { name: "All fans" }));
    expect(a.page.read().fan, "B03: All remains symbolic").toEqual({ kind: "all" });
    act(() => typedSubjectDoor(a)!.add([localId("ducts-fan", "9cb9f188-28aa-4094-8b76-785395cc35e1-00000001@2")]));
    expect(a.page.read().fan, "B03: additive open never narrows All").toEqual({ kind: "all" });
    fireEvent.click(roster.getByRole("button", { name: "Clear fans" }));
    expect(a.page.read().fan, "B03: None remains explicit").toEqual({ kind: "ids", ids: [] });
    roster.unmount();
  } finally { cleanup(); mounts.forEach(m => m.dispose()); registry.dispose(); }
});

import { Context, Effect, Layer, Queue, Option } from "effect";
import { createRootRoute, createRouter, createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { HostReceipts } from "../../../host/src/gateway-owner";
import { ReadOwner } from "../../../host/src/builtin-inputs";
import { makeCallRoute } from "../../../host/src/call-route";
import { sdkSessions } from "../../../host/tests/native-receipt-fixture";
import { bootHost } from "../../../host/tests/real-server";
import { connectTestBridge } from "../../../host/tests/bridge-fixture";
import { admittedReceiptStamps } from "../../../host/src/receipt-export";
import "../ducts/sheet/mount";
import { builtins } from "../route/builtins.neutral";
import { bindActionReadings } from "../host/resource-stream";

const trace = vi.hoisted(()=>({submit:vi.fn(),fetch:vi.fn(),base:"",target:null as any,results:[] as any[]}));
vi.mock("../host/runtime",()=>({hostFetch:trace.fetch,runtimeStreamUrl:(url:string)=>new URL(url,trace.base).toString()}));
vi.mock("../../../host/src/session-route",async actual=>{const real=await actual<any>();const {Effect}=await import("effect");const {sdkSessions}=await import("../../../host/tests/native-receipt-fixture");return {...real,runPeRevitCli:(args:any)=>Effect.promise(()=>sdkSessions(args))};});
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async actual => {const real=await actual<any>(); trace.submit.mockImplementation(async(...args:any[])=>{const row=await real.submitAction(...args);((trace as any).results??=[]).push(row);return row;}); return {...real,submitAction:trace.submit};});
const ambient = <S,I>(tag:Context.Key<S,I>)=>Layer.effect(tag,Effect.serviceOption(tag).pipe(Effect.map(Option.getOrThrow)));


import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

test("JZ Fans Revert removes A from Plan before staging B",async()=>{
 trace.results=[];
 trace.submit.mockClear();
 const originalFetch=globalThis.fetch;
 const streams=new Set<any>();
 const requests:any[]=[];
 let bridge:any;
 const roster=nativeResponseSchema("ducts.snapshot.roster").parse(rosterCapture);
 const walk=nativeResponseSchema("ducts.snapshot.walk").parse(walkCapture);
 const tables=nativeResponseSchema("ducts.tables").parse({folder:"fixture",tables:{},missing:[],unsupported:{}});
 const native=Layer.effect(HostNativeRead,Effect.gen(function*(){
   bridge=yield* connectTestBridge(); trace.target=bridge.target;
   yield* Effect.forkScoped(Effect.forever(Queue.take(bridge.outgoing).pipe(Effect.flatMap((frame:any)=>{
     const request=frame.request;if(!request)return Effect.void;
     requests.push({key:request.operationKey,input:JSON.parse(request.payloadJson)});
     const value=request.operationKey==="ducts.snapshot.roster"?roster:request.operationKey==="ducts.snapshot.walk"?walk:request.operationKey==="ducts.tables"?tables:request.operationKey==="ducts.apply.plan"?(()=>{
       const input=JSON.parse(request.payloadJson);
       const writes=(input.components??[]).map((row:any)=>({id:row.id,kind:"component",outcome:"planned",before:"unset",after:`${row.inWg} in-wg`,reason:null}));
       return {previewOnly:true,writes,counts:{planned:writes.length,written:0,refused:0,unchanged:0},systemsAfter:[],storeRevision:0};
     })():request.operationKey==="revit.catalog.field-options"?{descriptor:{key:JSON.parse(request.payloadJson).key,mode:"Suggestion",allowsCustomValue:true,dependsOn:[],requiredRuntimeMode:"LiveDocument"},items:[],result:{kind:"Success",message:""}}:{};
     const reply=Queue.offer(bridge.incoming,JSON.stringify({kind:"Response",response:{requestId:request.requestId,openDocumentId:request.openDocumentId,ok:true,statusCode:200,payloadJson:JSON.stringify(value),metrics:{requestBytes:0,responseBytes:0,revitExecutionMs:0,roundTripMs:0,serializationMs:0}}}));
     return reply;
   }))));
   return yield* HostNativeRead;
 })).pipe(Layer.provide(ambient(HostNativeRead)),Layer.provide(ambient(RevitBridge)));
 const dir=await mkdtemp(join(tmpdir(),"pe-f05-bisect-"));
 const stamp=admittedReceiptStamps().host!;
 const captureStore=await Effect.runPromise(openRecordingWriter(dir,{build:JSON.stringify({version:stamp.version,build:stamp.build,commit:stamp.commit}),catalog:nativeCatalogIdentity()},{maxBytes:256*1024*1024,maxTakings:10000}));
 const inputs=await Effect.runPromise(HostInputContext.pipe(Effect.provide(HostInputContext.layer({kind:"live",captureStore}))));
 const host=await bootHost({inputs,reads:{live:{marks:ambient(HostDocumentMarks),inventory:HostSessionInventory.layer.pipe(Layer.provide(Layer.mergeAll(ambient(RevitBridge),ambient(SdkSession)))),files:DuctFiles.layer(),native}},revitCompositionFactory:()=>({provider:RevitBridgeLive,routes:Layer.unwrap(Effect.gen(function*(){const reads=yield* ReadOwner;return makeCallRoute((yield* HostReceipts).journal,undefined,{workspace:reads.work.workspace,sdk:sdkSessions,workReads:reads.work.reads},{pointers:reads.work.pointers,retainedRead:reads.retainedCall,nativeBody:reads.nativeBody});})).pipe(Layer.provide(native))})});
 trace.base=host.base;
 const forward=async(url:any,init:any={})=>{
   const headers=new Headers(init.headers);headers.set("x-pe-context",host.terminal);headers.set(HOST_RUNTIME_SERVICE_HEADER,hostOwnership.serviceName);
   const target=new URL(typeof url==="string"?url:url.url??url.href,host.base);
   return originalFetch(`${host.base}${target.pathname}${target.search}`,{...init,headers});
 };
 trace.fetch.mockImplementation(forward);vi.stubGlobal("fetch",forward);
 class Stream {
   onopen:any;onmessage:any;onerror:any;controller=new AbortController();
   keys=new Set<string>();
   constructor(readonly url:string){streams.add(this);void this.start(url);}
   deliver(data:string){this.onmessage?.({data});}
   async start(url:string){try{const response=await forward(url,{signal:this.controller.signal});if(!response.ok)throw Error(await response.text());this.onopen?.({});const reader=response.body!.getReader();let buffer="";while(!this.controller.signal.aborted){const chunk=await reader.read();if(chunk.done)break;buffer+=new TextDecoder().decode(chunk.value);let end;while((end=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split("\n").filter(s=>s.startsWith("data:")).map(s=>s.slice(5).trimStart()).join("\n");if(data)this.deliver(data);}}}catch(error){if(!this.controller.signal.aborted)this.onerror?.(error);}}
   close(){this.controller.abort();streams.delete(this);}
 }
 vi.stubGlobal("ResizeObserver",class {observe(){} unobserve(){} disconnect(){}});
 vi.stubGlobal("EventSource",Stream);
 const unbind=bindActionReadings();
 let generation=0;
 const {fansReadResponse,address:workAddress}=await import("@pe/agent-contracts");
 const source: import("../shell/source-contract").UseSource={kind:"use",open(ctx,deliver){
   const subscription=crypto.randomUUID(),current=++generation;
   const body={read:"fans.sheet",subscription,generation:current,args:{target:trace.target,...ctx.args as object}};
   void forward("/pe/reads/value",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(async response=>{
     const wire=await response.json();if(!response.ok)throw Error(JSON.stringify(wire));const value=fansReadResponse.parse(wire);
     if(!ctx.signal.aborted)deliver({kind:"complete",value,revision:value.version});
   }).catch(error=>{if(!ctx.signal.aborted)deliver({kind:"failure",error});});
   return ()=>{void forward("/pe/reads/value",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,generation:++generation,release:true})});};
 }};
 const selected=localId("ducts-fan",`${walk.nodes.find(n=>n.id===14577391)!.uniqueId}@2`);
 let search=new URLSearchParams({fan:JSON.stringify({kind:"ids",ids:[selected]})});
 const {TypedWrite}=await import("../shell/typed-shell");
 const {KeyScopeHost}=await import("@pe/kit/keys");
 const mount=mountTypedRoute(fans,{
   target:{kind:"document",ref:trace.target},fixture:null,work:{address:workAddress("C:/model.rvt"),open:trace.target},
   address:{read:()=>new URLSearchParams(search),write:next=>{search=new URLSearchParams(next);},subscribe:()=>()=>{}},
   custody:{current:()=>true},memory:()=>({}),
 },workFingerprintSchema.parse(`builtin-closure:${builtins.fans.closure.fingerprint}`),{sources:{"fans.sheet":source}});
 const React=await import("react");
 const {InputsBody}=await import("../ducts/sheet/mount");
 const registry=makeAtomRegistry();
 function Journey(){const [,set]=React.useState(0);React.useEffect(()=>mount.subscribe(()=>set(n=>n+1)),[]);return <TestAttention registry={registry}><SubjectDoor value={typedSubjectDoor(mount)}><KeyScopeHost id="scope-revert"><TypedWrite mount={mount} id="losses"/>{mount.draw("sheet-inputs",ctx=><InputsBody ctx={ctx as any}/>) as React.ReactNode}</KeyScopeHost></SubjectDoor></TestAttention>;}
 const router=createRouter({routeTree:createRootRoute({component:Journey}),history:createMemoryHistory({initialEntries:["/fans"]})});
 const phase=(at:string)=>{if(process.env.PE_FANS_SCOPE_EVIDENCE)writeFileSync(process.env.PE_FANS_SCOPE_EVIDENCE,JSON.stringify({at,revision:mount.owner()?.handle?.revision,problem:mount.reviewProblem("losses"),results:(trace as any).results,requests},null,2));};
 try{
   render(<RouterProvider router={router}/>);
   await vi.waitFor(()=>expect(mount.startAction()).toBeTruthy(),{timeout:20000});
   await vi.waitFor(()=>expect(mount.owner()?.scope.key.binding).toBe("address"),{timeout:20000});

   for(const route of Object.keys(fans.spec.edits!.owners)){
     const owner=mount.owner(route)!;
     if(owner!==mount.owner()){
       await vi.waitFor(()=>expect(owner.ready).toBe(true),{timeout:20000});
       expect(owner.handle?.revision).toBe(0);
       continue;
     }
     await vi.waitFor(()=>expect(owner.absent).toBe(true),{timeout:20000});
     expect(owner.handle).toBeNull();
     const id=crypto.randomUUID();
     const started=await forward("/actions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
       id,key:"work.start",target:{kind:"host"},input:{key:owner.scope.key,seed:owner.config.state.schema.parse({})},
     })});
     expect([200,202]).toContain(started.status);
     const settled=await forward(`/actions?id=${id}&wait=25000`);
     expect((await settled.json())[0]).toMatchObject({id,key:"work.start",state:"succeeded"});
     await vi.waitFor(()=>expect(mount.owner(route)?.ready).toBe(true),{timeout:20000});
   }

   act(()=>mount.refresh());
   await screen.findByRole("button",{name:"None"},{timeout:20000});
   const user=userEvent.setup();
   const edit=async(id:string,value:string)=>{
     const row=await vi.waitFor(()=>{const row=document.querySelector(`[data-input-field="component:${id}:drop"]`);expect(row, JSON.stringify({fields:[...document.querySelectorAll("[data-input-field]")].map(e=>e.getAttribute("data-input-field")),text:document.body.textContent?.slice(-3500),value:mount.value().status})).toBeTruthy();return row!;});
     const input=within(row as HTMLElement).getByRole("textbox");
     await user.clear(input);await user.type(input,`${value}{Enter}`);
   };
   await edit("14577394","0.02");
   await vi.waitFor(()=>expect(mount.owner()?.handle?.revision).toBe(2),{timeout:20000});
   phase("r2");
   act(()=>mount.refresh());
   await vi.waitFor(()=>expect(mount.value().current).toBe(true),{timeout:20000});
   fireEvent.click(await screen.findByRole("button",{name:"None"}));
   fireEvent.click(await screen.findByRole("option",{name:/MUAS-1.*1 staged/}));
   await vi.waitFor(()=>expect(mount.owner()?.handle?.revision).toBe(3),{timeout:20000});
   phase("r3");
   act(()=>mount.refresh());
   await vi.waitFor(()=>expect(mount.value().current).toBe(true),{timeout:20000});
   fireEvent.click(screen.getByRole("button",{name:/Revert.*DS.?1/i}));
   await vi.waitFor(()=>expect(mount.owner()?.handle?.revision).toBe(4),{timeout:20000});
   phase("r4");
   act(()=>mount.refresh());
   await vi.waitFor(()=>expect(mount.value().current).toBe(true),{timeout:20000});
   await edit("13493812","0.01");
   await vi.waitFor(()=>expect(mount.owner()?.handle?.revision).toBe(5),{timeout:20000});
   phase("r5");
   act(()=>mount.refresh());
   await vi.waitFor(()=>expect(mount.value().current).toBe(true),{timeout:20000});
   phase("before Plan");
   fireEvent.click(await screen.findByRole("button",{name:"plan Write to Revit"}));
   await vi.waitFor(()=>expect(trace.results).toHaveLength(1),{timeout:20000});
   expect(trace.results[0].state,trace.results[0].error ?? mount.reviewProblem("losses")).toBe("succeeded");
   await vi.waitFor(()=>expect(mount.review("losses")?.cells?.length).toBeGreaterThan(0),{timeout:20000});
   const plan=requests.findLast(row=>row.key==="ducts.apply.plan");
   expect(plan.input.components).toEqual([expect.objectContaining({id:13493812,inWg:0.01})]);
   expect(JSON.stringify(plan.input)).not.toContain("14577394");
   expect(mount.reviewProblem("losses")).toBeNull();
   expect(screen.getByRole("button",{name:"Write to Revit"}).hasAttribute("disabled")).toBe(false);
   expect(document.body.textContent).not.toContain("no staged edit");
 } finally {
   phase("finally");
   cleanup();mount.dispose();registry.dispose();unbind();for(const stream of streams)stream.close();
   vi.unstubAllGlobals();await host.close();await rm(dir,{recursive:true,force:true});
 }
},60000);
