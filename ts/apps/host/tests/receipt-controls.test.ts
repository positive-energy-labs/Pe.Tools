import { expect, test } from "vite-plus/test";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executionTargetSchema, persistedActionReceiptSchema, persistedReceiptSchema, type RetainedOriginalTarget } from "@pe/agent-contracts";
import { fixtureNative } from "./fixture-native.ts";

test("INT-RECEIPT original-ID controls retain evidence: read answers and Stop refuses a settled action",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"pe-receipt-controls-"));
  const exact={kind:"document" as const,ref:{session:"sdk-original",processIncarnation:{pid:42,startedAt:1000},openId:"original-open"}};
  const historical:RetainedOriginalTarget=executionTargetSchema.safeParse(exact).success
    ? {kind:"document",ref:{session:"private-original",openId:"original-open"}} : exact;
  const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const lines=[JSON.stringify({version:8})];
  for(const [index,target] of [historical,{kind:"host" as const}].entries()){
    const id=index===0 ? "historical" : "current";
    const value=persistedActionReceiptSchema.parse({id,key:"pod.export",target,input:{pod:"original",archivePath:"original.zip"},
      caller:{kind:"human",via:"cli"},basis:null,steps:[],prepared:{state:"unprepared"},recovery:[],
      startedAt:"2026-11-16T18:00:00Z",state:"succeeded",result:{original:true}});
    lines.push(JSON.stringify({mapping:[JSON.stringify(["action",id]),uuid(index*3+1)]}),
      JSON.stringify({mapping:[JSON.stringify(["action-request",id]),uuid(index*3+2)]}),
      JSON.stringify({receipt:persistedReceiptSchema.parse({schema:1,id:uuid(index*3+3),revision:1,at:value.startedAt,stamp:null,
        join:{actionId:uuid(index*3+1),requestId:uuid(index*3+2)},body:{kind:"action",value}})}));
  }
  const path=join(directory,"partition-operations.json"),original=Buffer.from(lines.join("\n")+"\n");
  await writeFile(path,original);
  const native=await fixtureNative(directory),post=native.actions();
  const control=(verb:string,id:string)=>post.request(new Request(`http://host/actions/${verb}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id}),
  }));
  try{
    const read=await post.request(new Request("http://host/actions?id=historical"));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject([{id:"historical",target:{kind:"unavailable-original",original:historical},result:{original:true}}]);
    const cancelled=await control("cancel","historical");expect(cancelled.status).toBe(409);
    expect(await cancelled.text()).toContain("only an active action can be cancelled");
    expect(native.calls).toEqual([]);
    expect(await readFile(path)).toEqual(original);
  }finally{await native.close();}
});
