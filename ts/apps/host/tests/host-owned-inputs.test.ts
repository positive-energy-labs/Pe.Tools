import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { expect, test, vi } from "vite-plus/test";
import { HostNativeRead } from "@pe/host-internal/native-read";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { valueReadResponse } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { readInputRoutes } from "../src/builtin-inputs.ts";
import { HostInputContext } from "../src/input-context.ts";
import { PictureCaptures, PictureCaptureStore } from "../src/captures-route.ts";
import { HostDocumentMarks, hostMarks } from "../src/document-marks.ts";
import { HostSessionInventory } from "../src/session-inventory.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { openRecordingReader, openRecordingWriter, nativeCatalogIdentity, type HostInputLane } from "../src/native-recording.ts";
import * as localInputs from "../src/local-inputs.ts";
import { settle } from "./effect-test.ts";

test("recorded host-local inputs and immutable capture files replay without a live owner",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"pe-owner-inputs-"));
  const identity={build:"owner-inputs",catalog:nativeCatalogIdentity()},bounds={maxBytes:8*1024*1024,maxTakings:100};
  const pictures=new PictureCaptures(join(dir,"pictures"),1024*1024,()=>1);
  const bytes=Buffer.from("opaque-content-addressed-file");
  const receipt=await pictures.keep(bytes,{origin:"human",document:{},view:{},focus:null,registration:null});
  const writer=await settle(openRecordingWriter(join(dir,"bundle"),identity,bounds));
  const who={kind:"human" as const,via:"local" as const};
  const make=(lane:HostInputLane)=>{
    const inputs=Effect.runSync(HostInputContext.pipe(Effect.provide(HostInputContext.layer(lane))));
    return HttpRouter.toWebHandler(readInputRoutes(inputs,lane.kind === "live" ? {
      store:fileRouteDocumentStore(join(dir,"work")),live:{owner:new DuctsReadings(),
        native:Layer.succeed(HostNativeRead,{read:()=>Effect.die("No native read"),resolve:()=>Effect.die("No native resolution")}),
        files:DuctFiles.layer({firm:join(dir,"firm.json"),catalogs:join(dir,"catalogs")}),
        marks:Layer.succeed(HostDocumentMarks,hostMarks({observedSince:0,changedAt:()=>null,subscribe:()=>()=>{}})),
        inventory:Layer.succeed(HostSessionInventory,{list:()=>Effect.die("No inventory"),document:()=>Effect.die("No document"),session:()=>Effect.die("No session"),attachment:()=>Effect.die("No attachment"),subscribe:()=>()=>{}}),
      },
    }:{}).pipe(Layer.provide(Layer.succeed(PictureCaptureStore,pictures))),{disableLogger:true});
  };
  let live:ReturnType<typeof make>|undefined=make({kind:"live",captureStore:writer}),replay:ReturnType<typeof make>|undefined;
  const request=(web:ReturnType<typeof make>,path:string,body?:unknown)=>withInvocationContext({caller:who},()=>web.handler(new Request(new URL(path,"http://host"),body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{}),Context.make(RequestIdentity,admittedRequestIdentity(who,{}))));
  const read=async(web:ReturnType<typeof make>,key:string,readSet?:string)=>{
    const response=await request(web,peRouteUrl("reads.value",{}),{read:key,args:{},subscription:key,generation:0,...(readSet?{readSet}:{})});
    expect(response.status,await response.clone().text()).toBe(200);
    const result=valueReadResponse.parse(await response.json());expect(result.state,result.reason).toBe("current");return result.value!;
  };
  try {
    const captures=await read(live,"captures.browse"),pods=await read(live,"pods.roster");
    expect(JSON.stringify(captures.data)).not.toContain(bytes.toString("base64"));
    expect(captures.trace).toEqual(expect.arrayContaining([expect.objectContaining({name:"file:capture",args:receipt.sha})]));
    await live.dispose();live=undefined;
    vi.spyOn(pictures,"list").mockRejectedValue(Error("Live captures poisoned"));
    vi.spyOn(pictures,"blob").mockRejectedValue(Error("Live PNG poisoned"));
    const local=vi.spyOn(localInputs,"readLocal").mockRejectedValue(Error("Live Pods poisoned"));
    const reader=await settle(openRecordingReader(join(dir,"bundle"),identity,bounds));
    replay=make({kind:"recording",recordingStore:reader,at:null});
    expect((await read(replay,"captures.browse",captures.inputs)).data).toEqual(captures.data);
    expect((await read(replay,"pods.roster",pods.inputs)).data).toEqual(pods.data);
    const image=await request(replay,receipt.url);
    expect(image.status).toBe(200);expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
    expect(local).not.toHaveBeenCalled();
  } finally {vi.restoreAllMocks();await live?.dispose();await replay?.dispose();await rm(dir,{recursive:true,force:true});}
});
