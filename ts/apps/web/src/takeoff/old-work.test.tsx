// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { OLDER_WORK, UNREADABLE_WORK, bindWork, workKey, builtinClosureFingerprint, createBuiltinRouteInventory } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store";
import { createPeRoutes } from "../../../host/src/pe-routes";
import { route } from "../route/typed-route";
import { mountTypedRoute, type TypedMount } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { TypedWorkRecovery } from "../shell/typed-work-recovery";
import { module as takeoffs } from "./route";

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function Recovery({mount}:{mount:TypedMount}) {
  useSyncExternalStore(mount.subscribe,mount.revision,mount.revision);
  return <TypedWorkRecovery mount={mount}/>;
}

test.each([OLDER_WORK, UNREADABLE_WORK])(
  "takeoffs preserves the host refusal and only resets provably older Work: %s",
  async message=>{
    const dir=await mkdtemp(join(tmpdir(),"takeoffs-old-work-"));
    try {
    // A next trusted schema version makes a positive older-version witness possible.
    // The real declaration, renderer, host admission, disk Work and public reset door are used.
    const module=route({...takeoffs.spec,edits:{...takeoffs.spec.edits!,
      work:{...takeoffs.spec.edits!.work,schemaVersion:2},owners:{}}});
    const envelope={source:"builtin-closure" as const,version:1 as const,data:module.data,
      hostVersion:"old-work-surface",variants:[{client:"web" as const,entry:"fixture.ts"}],
      modules:[{id:"fixture.ts",sha256:"a".repeat(64)}],inputs:[],externals:[]};
    const fingerprint=await builtinClosureFingerprint(envelope);
    const inventory=createBuiltinRouteInventory({host:{module:module.host,host:true,
      closure:{envelope,fingerprint},catalog:Object.entries(module.entries).map(([key,entry])=>({key,...entry.axes,uses:[]}))}});
    const admitted=(await inventory.prepare("host",fingerprint)).admitHost(module.host);
    if(!admitted.ok) throw Error(JSON.stringify(admitted.diagnostics));
    const disk=fileRouteDocumentStore(dir),workspace=new RouteWorkspace({registrations:[],store:disk});
    const registration=workspace.registerAdmitted(admitted.route);
    const ref={session:"session-takeoffs-old-work",openId:"open-1"};
    const key=bindWork("takeoffs",null,undefined,ref);
    const raw={version:1,...(message===OLDER_WORK?{schemaVersion:1}:{}),revision:7,doc:{retired:true},history:[]};
    await disk.setState({targetKey:workKey(key),route:key.route,value:raw});
    const saved=join(dir,(await readdir(dir))[0]!);
    const original=await readFile(saved,"utf8");
    const api=createPeRoutes({workspace,registrations:[],navigation:{
      threads:async()=>[],
      documents:async()=>[{...ref,address:null}],
    }});
    const posts:string[]=[],responses:string[]=[];
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      const request=input instanceof Request?input:new Request(new URL(String(input),"http://host"),init);
      if(request.method==="POST") posts.push(request.url);
      const response=await withInvocationContext({caller:{kind:"human",via:"local"}},()=>api.fetch(request));
      if(!response) throw Error(`No HTTP route for ${request.url}`);
      responses.push(`${response.status} ${await response.clone().text()}`);
      return response;
    });
    const work=createWorkFeedClient({subscribe:observeResources(workspace,{observe:()=>()=>{}}),dirty(){}},
      {write:(key,write)=>workspace.write(key,key.route,"human",write),submit:()=>{throw Error("No native command during recovery");}});
    const mount=mountTypedRoute(module,{fixture:null,target:{kind:"document",ref},work:{address:null,open:ref},
      custody:{current:()=>true},memory:()=>({}),address:{read:()=>new URLSearchParams(),write(){},subscribe:()=>()=>{}}},admitted.route.workFingerprint,
      {work,sources:Object.fromEntries([module.spec.core!,...Object.values(module.spec.reads??{})].map(read=>[read.key,{kind:"use",open:()=>()=>{}}]))});
    try {
      render(<Recovery mount={mount}/>);
      await waitFor(()=>expect(mount.owner()?.failure).toMatchObject({kind:"failed",code:"WorkUnreadable",
        schemaAge:message===OLDER_WORK?"older":"unknown"}));
      const refusal=mount.owner()?.failure;
      if(!refusal||refusal.kind!=="failed") throw Error("Expected the host's named Work refusal");
      await waitFor(()=>expect(screen.getAllByRole("alert").map(node=>node.textContent)).toContain(refusal.message));
      if(message===UNREADABLE_WORK) {
        expect(screen.queryByRole("button",{name:"Start fresh"})).toBeNull();
        expect(posts).toEqual([]);
        expect(await readFile(saved,"utf8")).toBe(original);
        return;
      }
      fireEvent.click(screen.getByRole("button",{name:"Start fresh"}));
      const review=await screen.findByRole("dialog",{name:"Start fresh review"});
      expect(screen.getByText(message)).toBeTruthy();
      fireEvent.click(within(review).getByRole("button",{name:"Commit Start fresh"}));
      await waitFor(()=>expect(screen.queryByText(message),responses.join("\n")).toBeNull());
      await waitFor(()=>expect(mount.owner()?.ready).toBe(true));
      expect(posts).toHaveLength(1);
      expect(new URL(posts[0]!).pathname).toBe("/pe/route-state/takeoffs/start-fresh");
      expect(posts[0]).not.toContain("/agent/");
      expect(module.data.verbs).not.toHaveProperty("work.start-fresh");
      expect(mount.owner()?.doc).toEqual(module.spec.edits!.work.schema.parse({}));
      const records=await disk.listState!();
      expect(records.records.find(row=>row.route==="takeoffs:aside:1")?.value).toEqual(raw);
    } finally {
      cleanup();mount.dispose();registration.close();
    }
    } finally { await rm(dir,{recursive:true,force:true}); }
  },60000,
);
