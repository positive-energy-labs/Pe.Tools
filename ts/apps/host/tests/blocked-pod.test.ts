import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, vi } from 'vite-plus/test';
import { capturePackage, listPackages } from '../src/packages.ts';
import { stopPackageDiscovery } from '../src/pod-capture.ts';
import { createPagesHandler } from '../src/pages-route.ts';
import { stateFixture } from '../../../tests/isolated-home/storage.ts';
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>() }));

test('review: a blocked changed Pod must not prevent a healthy Page from answering', async () => {
 const root = await fs.mkdtemp(join(tmpdir(), 'pe-review-block-'));
 let release: (()=>void) | undefined;
 try {
  const pods=join(root,'Pods');
  for(const id of ['broken','healthy']) {
   await fs.mkdir(join(pods,id,'pages','hello'),{recursive:true});
   await fs.writeFile(join(pods,id,'pod.json'),JSON.stringify({id}));
   await fs.writeFile(join(pods,id,'pages','hello','index.html'),`<title>${id}</title>`);
  }
  const handler=createPagesHandler([],pods,undefined,undefined,stateFixture(join(root,'state')));
  expect((await handler(new Request('http://host/pages/healthy--hello/'))).status).toBe(200);
  const blocked=join(pods,'broken','pages','hello','index.html');
  await fs.writeFile(blocked,'<title>changed broken</title>');
  await fs.writeFile(join(pods,'healthy','pages','hello','index.html'),'<title>fresh healthy</title>');
  const original=fs.open;
  const gate=new Promise<void>(ok=>{release=ok;});
  vi.spyOn(fs,'open').mockImplementation(async (...args)=>{
   if(String(args[0])===blocked) await gate;
   return original(...args);
  });
  const response=await handler(new Request('http://host/pages/healthy--hello/'));
  console.log('HEALTHY RESPONSE',response.status,await response.clone().text());
  expect(response.status).toBe(200);
 } finally {
  release?.();
  vi.restoreAllMocks();
  stopPackageDiscovery();
  await new Promise(ok=>setTimeout(ok,50));
  await fs.rm(root,{recursive:true,force:true});
 }
});

// Several pending Pods distinguish a per-Pod bound from a serial timeout per directory.
test.each(['open', 'lstat'] as const)('pending %s in several Pods leaves healthy Page edits fresh', async kind => {
 const root = await fs.mkdtemp(join(tmpdir(), 'pe-pending-pods-'));
 const gate = Promise.withResolvers<void>();
 try {
  const pods=join(root,'Pods');
  const ids=['broken-0','broken-1','broken-2','healthy'];
  const page=(id:string)=>join(pods,id,'pages','hello','index.html');
  for(const id of ids) {
   await fs.mkdir(join(page(id),'..'),{recursive:true});
   await fs.writeFile(join(pods,id,'pod.json'),JSON.stringify({id}));
   await fs.writeFile(page(id),`<title>${id}</title>`);
  }
  const handler=createPagesHandler([],pods,undefined,undefined,stateFixture(join(root,'state')));
  expect((await handler(new Request('http://host/pages/healthy--hello/'))).status).toBe(200);
  for(const id of ids) await fs.writeFile(page(id),`<title>changed ${id}</title>`);
  if(kind==='open') {
   const original=fs.open;
   vi.spyOn(fs,'open').mockImplementation(async (...args)=>{
    if(ids.slice(0,3).some(id=>String(args[0])===page(id))) await gate.promise;
    return original(...args);
   });
  } else {
   const original=fs.lstat;
   vi.spyOn(fs,'lstat').mockImplementation(async (...args)=>{
    if(ids.slice(0,3).some(id=>String(args[0])===page(id))) await gate.promise;
    return original(...args);
   });
  }
  for(let revision=0;revision<2;revision++) {
   await fs.writeFile(page('healthy'),`<title>fresh ${revision}</title>`);
   const started=performance.now();
   const response=await handler(new Request('http://host/pages/healthy--hello/'));
   console.log('PENDING PODS',kind,Math.round(performance.now()-started),response.status);
   expect(response.status).toBe(200);
   expect(await response.text()).toContain(`fresh ${revision}`);
   for(const id of ids.slice(0,3)) await expect(capturePackage(id,pods)).rejects.toMatchObject({code:'pod.discovery.exceeded'});
  }
  gate.resolve();
  vi.restoreAllMocks();
  await new Promise(ok=>setTimeout(ok,50));
  expect((await listPackages({podsRoots:pods})).packages.every(pod=>!pod.discoveryFailure)).toBe(true);
  const recovered=await handler(new Request('http://host/pages/broken-0--hello/'));
  expect(recovered.status).toBe(200);
  expect(await recovered.text()).toContain('changed broken-0');
 } finally {
  gate.resolve();
  vi.restoreAllMocks();
  stopPackageDiscovery();
  await new Promise(ok=>setTimeout(ok,50));
  await fs.rm(root,{recursive:true,force:true});
 }
});
