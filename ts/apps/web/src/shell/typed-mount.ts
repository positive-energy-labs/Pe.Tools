import { hostReadSource } from "./host-read-source.ts";
import { writeReject } from "./catalog-work-reviews";
import { harnessClient } from "../workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "../workbench/config";
import { z } from "zod";
import { readableRefusal } from "../route/readable-refusal";

/** Host refusals carry serialized issues; local Value decoding throws the same issues. */
function valueRefusal(error: unknown, read: string): string {
  return readableRefusal(error, `Value unavailable (${read}): the model reading does not match its contract. Refresh to try again.`);
}
import { decodeField } from "../route/field-codec";
import {
  applyPatches,
  bindWork,
  cellPatches,
  commands,
  commandTarget,
  canonicalRouteInput,
  workKey,
  writePreviewSchema,
  presentationSchema,
  workHandleSchema,
  workFeedFailureMessage,
  type WorkFeedFailure,
  type WorkHandle,
  type WorkWrite,
  type RouteStatePatch,
  bare,
  focusSelectionSchema,
  type WorkJournalDoor,
  type WorkScope,
  type RouteFingerprint,
  type InvocationToken,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import { createRouteScopeGate } from "@pe/runtime/route-scope-gate";
import { applicationWorkRegistry, createApplicationWorkRegistry } from "./application-work-registry";
import { createWorkFeedClient } from "./work-feed-client";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { publicationPose, recordedWorkDoor } from "./history";
import { settleWork } from "./work-door-observation";
import { freezePage } from "./page-port";
import type { PlaceInput } from "./typed-place";
import type { ReadingContext, ReadingSource } from "./source-contract";
import type { DrawContext, EditFailure, EditHistory, TypedRoute } from "../route/typed-route";
import { cancelAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { observeSubject, subjectScopeKey, type SubjectState } from "./subject";



type Value = DrawContext<any, any, any, any>["value"];
const unavailable = (reason: string, value?: any, publication: Value["publication"] = null): Extract<Value,{current:false}> =>
  ({ current: false, status: "unavailable", reason, publication, ...(value === undefined ? {} : { value }) });

/** Typed routes execute declarations directly. No graph admission, body slots or reading scheduler. */
export function mountTypedRoute(module: TypedRoute, input: PlaceInput, fingerprint: RouteFingerprint,
  ports: { work?: WorkJournalDoor; sources?: Record<string, ReadingSource> } = {}) {
  const cleanups: (() => void)[] = [];
  try {
  const { spec } = module;
  const edits = spec.edits;
  const own = edits?.work.route ?? spec.key;
  const ownerConfigs = edits?.owners ?? {};
  const ownerStops: (()=>void)[] = [];
  cleanups.push(()=>ownerStops.splice(0).reverse().forEach(stop=>stop()));
  const registry = input.fixture === null && !input.history ? applicationWorkRegistry : createApplicationWorkRegistry();
  const listeners = new Set<() => void>();
  let revision = 0, disposed = false, released = false;
  const notify = () => { if (!disposed) { revision++; listeners.forEach(f => f()); } };
  const requireCurrent = () => {
    if (disposed || !input.custody.current()) throw Error("Place is not writable");
  };
  const requireWritable = () => {
    requireCurrent();
    if (input.readOnly || input.history) throw Error("needs live Revit");
  };
  const decodePage = () => {
    const search = input.address.read();
    const memory = z.record(z.string(),z.unknown()).parse(input.memory() ?? {});
    return freezePage({ ...Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => {
      const raw = search.get(key);
      return [key, decodeField(field, raw === null ? memory[key] ?? field.initial : raw)];
    })), selected: decodeField({ schema: focusSelectionSchema, initial: [] }, search.has("selected") ? search.get("selected") : memory.selected ?? []) });
  };
  const owners = new Map<string, {
    scope: WorkScope; config: import("../route/typed-route").Owners[string]; handle: WorkHandle | null;
    doc: any; ready: boolean; absent:boolean; problem: string | null; failure: WorkFeedFailure | null;
    lease: ReturnType<typeof registry.acquire>;
  }>();
  let page: Record<string, any> = decodePage();
  const selectedKey = () => {
    if(!edits) return null;
    if(edits.key) {const member=edits.key(page as never);return member === null ? null : bindWork(own,null,member);}
    return bindWork(own,input.work.address,undefined,input.work.open ?? undefined);
  };
  let key = selectedKey();
  let renderedBasis: InvocationToken | null = null;
  const reads = new Map<import("../route/host-read").HostRead, { snapshot: Value; args: string; stop(): void }>();
  const dependencies = () => Object.fromEntries([...reads].filter(([read,r])=>read === spec.core && r.snapshot.current).map(([read,r])=>[read.key,r.snapshot.current?r.snapshot.hash??"":""]));
  const workSchema:z.ZodObject=edits?.work.schema ?? z.strictObject({});
  const gate = createRouteScopeGate({
    workSchema, hashWork: canonicalRouteInput,
    journal: key => owners.get(key.route)!.lease.entry.journal,
    dependencies,
    preparePage: (_page, patch) => ({ ok: true, value: { page: patch, changed: true, membership: "unresolved" } }),
  });
  cleanups.push(() => { for (const r of reads.values()) r.stop(); gate.close(); });
  gate.enter({ target: input.target, work: key }, page);
  let workAttempt = gate.capture("work");
  let door = input.history ? recordedWorkDoor(input.history) : ports.work ?? createWorkFeedClient();
  if (edits && key && spec.core && !input.history && input.fixture !== null) {
    const packet = spec.core.source.provide?.(input.fixture, spec.core.args(page as never));
    if (!packet?.value) throw Error(`Missing fixture ${input.fixture}`);
    const data = packet.value.data as Record<string,unknown>;
    door = createFixtureWorkDoor(edits!.work, data[edits!.owners[own]!.value!],
      Object.fromEntries(Object.entries(edits!.owners).map(([id,c]) => [id,c.state.schema])),
      Object.fromEntries(Object.entries(edits!.owners).map(([id,c]) => [id,data[c.value!]])),
      Object.fromEntries(Object.keys(edits!.owners).map(id => [id,id])));
  }
  const accept = (record: typeof owners extends Map<string, infer R> ? R : never, handle: WorkHandle, doc: unknown) => {
    if (disposed || owners.get(record.scope.key.route) !== record) return;
    if (record.handle && handle.revision < record.handle.revision) return;
    if(workKey(handle.key)!==workKey(record.scope.key)) throw Error("Work snapshot belongs to another Work");
    const parsed = record.config.state.schema.parse(doc);
    if (record.handle?.revision === handle.revision && canonicalRouteInput(record.doc) !== canonicalRouteInput(parsed))
      throw Error("Contradictory Work revision; refresh this route");
    record.absent=false; record.handle = freezePage(handle); record.doc = freezePage(parsed); record.ready = true; record.problem = null; record.failure = null;
    record.lease.entry.journal.observe({ revision: handle.revision, doc: parsed });
    if (handle.key.route === own) gate.acceptWork(workAttempt,
      { kind: "snapshot", handle, value: parsed, hash: canonicalRouteInput(parsed) });
  };
  let ownerKey: string | undefined;
  const syncWork = () => {
    const next = selectedKey(), signature=canonicalRouteInput(next);
    if(ownerKey === signature) return;
    ownerKey=signature;
    ownerStops.splice(0).reverse().forEach(stop=>stop()); owners.clear();
    key=next; renderedBasis=null;
    gate.enter({target:input.target,work:key},page); workAttempt=gate.capture("work");
    if(!key) return;
  for (const [id, config] of Object.entries(ownerConfigs)) {
    const scope: WorkScope = { route: spec.key, fingerprint, key: { ...key, route: id },
      target: input.target, subject: null };
    const lease = registry.acquire(scope.key);
    const record = { scope, config, handle: null as WorkHandle | null, doc: null as any,
      ready: false, absent:false, problem: null as string | null, failure: null as WorkFeedFailure | null, lease };
    owners.set(id, record);
    ownerStops.push(() => lease.release());
    lease.entry.connect(scope, door);
    const stopJournal = lease.entry.subscribe(notify);
    ownerStops.push(stopJournal);
    const stopFeed = door.open(scope).subscribe(state => {
      if (disposed || owners.get(id) !== record) return;
      try {
        if (state.kind === "ready") {
          accept(record, state.snapshot.handle, state.snapshot.value);
          lease.entry.restore(state);
        } else if (state.kind === "ack" && record.handle) {
          const ack = state.ack;
          if (ack.revision > record.handle.revision) {
            const result = applyPatches(config.state, { version: 1, revision: record.handle.revision, doc: record.doc },
              ack.by, ack.patches, ack.base, true, true);
            if (!result.ok) throw Error("error" in result ? result.error : "Work acknowledgement was refused");
            accept(record, { key: ack.key, revision: ack.revision }, result.envelope.doc);
          }
          lease.entry.journal.accept(ack);
        } else if (state.kind !== "ack") {
          record.ready = false;
          record.absent=state.kind === "absent";
          if(record.absent){record.doc=null;record.handle=null;}
          record.failure=state.kind === "failed"?state.failure:null;
          record.problem = record.failure ? workFeedFailureMessage(record.failure) : record.absent ? "Start this Work to edit" : "Reading Work...";
        }
      } catch (error) { record.ready = false; record.problem = String(error); }
      notify();
    }, notify);
    ownerStops.push(stopFeed);
  }
  };
  syncWork();
  const allReads = new Set([spec.core,...Object.values(spec.reads ?? {}),...Object.values(spec.panes).map(p=>p.read)].filter((read):read is import("../route/host-read").HostRead=>!!read));
  const demanded = new Set<import("../route/host-read").HostRead>();
  const syncReads = (force = false) => {
    if (disposed || released) return;
    for (const read of allReads) {
      if(read.demand === "explicit" && !demanded.has(read)) continue;
      const project = "args" in read && typeof read.args === "function" ? read.args : spec.core?.args ?? (()=>({}));
      const args = read.input.parse(project(page as never)), signature = canonicalRouteInput(args);
      if (!force && signature === reads.get(read)?.args) continue;
      const previous = reads.get(read)?.snapshot;
      const retained=previous?.publication?freezePage({...previous.publication,freshness:"refresh-needed" as const}):null;
      reads.get(read)?.stop();
      const controller = new AbortController();
      const record: {snapshot:Value;args:string;stop():void} = { args: signature, snapshot: { ...unavailable("Reading...", previous?.value,retained),status:"pending" }, stop: () => controller.abort() };
      reads.set(read, record);
      const deliver = (frame: Parameters<Extract<ReadingSource, { kind: "use" | "feed" }>["open"]>[1] extends (arg: infer P) => any ? P : never) => {
        if (controller.signal.aborted || disposed || reads.get(read) !== record) return;
        if (frame.kind === "complete" || frame.kind === "part") {
          try {
            const packet = read.output.parse(frame.value);
            const publication = freezePage(packet.value);
            const current = frame.kind === "complete" && frame.fresh !== false && packet.state === "current" &&
              !!packet.value && !packet.value.coverage.unknown.length && !packet.value.coverage.refused.length;
            record.snapshot = current ? { status: "ready", current: true, value: publication!.data, publication, hash: packet.value!.evaluation }
              : unavailable(valueRefusal(frame.reason ?? packet.reason ?? "Incomplete Value", read.key), publication?.data??record.snapshot.value, publication??record.snapshot.publication);
          } catch (error) { record.snapshot = unavailable(valueRefusal(error, read.key), record.snapshot.value, record.snapshot.publication); }
        } else if (frame.kind !== "log") record.snapshot = frame.kind === "failure"?unavailable(valueRefusal(frame.error, read.key),record.snapshot.value,record.snapshot.publication):{...unavailable("Reading...",record.snapshot.value,record.snapshot.publication),status:"pending"};
        notify();
      };
      if (input.fixture !== null) {
        try { deliver({ kind: "complete", value: read.source.provide!(input.fixture, args), revision: 1 }); }
        catch (error) { deliver({ kind: "failure", error }); }
      } else {
        const ctx: ReadingContext = { target: input.target!, workKey: key, workRevision: null,
          historyPoint: input.history?.point.id,
          historyPose: input.publicationInstance ? publicationPose(input.publicationInstance,spec.key,page) : undefined,
          work: null, page, args, signal: controller.signal, inputs: {},
          attempt: { target: input.target!, workKey: key, generation: revision }, trigger: { kind: "demand" } };
        const source = ports.sources?.[read.key] ?? hostReadSource(read);
        if (source.kind !== "use" && source.kind !== "feed") throw Error("Typed panes require a host Value");
        Promise.resolve(source.open(ctx, deliver)).then(stop => {
          if (controller.signal.aborted) stop?.();
          else record.stop = () => { controller.abort(); stop?.(); };
        }).catch(error => deliver({ kind: "failure", error }));
      }
    }
    notify();
  };
  const move = (patch: Record<string, unknown>, history?: "push" | "replace") => {
    requireCurrent();
    const next = { ...page, ...patch };
    for (const [key,value] of Object.entries(patch)) {
      if (key === "selected") focusSelectionSchema.parse(value);
      else spec.fields[key]!.schema.parse(value);
    }
    if(canonicalRouteInput(next)===canonicalRouteInput(page)) return {kind:"accepted",changed:false} as const;
    history ??= Object.keys(patch).some(key=>spec.fields[key]?.url==="push") ? "push" : "replace";
    page = freezePage(next);
    gate.movePage(page, { kind: "human", source: "query", history: "replace" });
    syncWork(); syncReads(); notify();
    const search = input.address.read();
    for (const [key,value] of Object.entries(patch)) search.set(key, JSON.stringify(value));
    input.address.write(search, history);
    return { kind: "accepted", changed: true } as const;
  };
  const moveRole = (role:"pose"|"query", patch:Record<string,unknown>, history?:"push"|"replace") => {
    for (const key of Object.keys(patch)) if (spec.fields[key]?.role !== role) throw Error(`${key} is not a ${role} field`);
    return move(patch,history);
  };
  const stopAddress = input.address.subscribe(() => {
    const next = decodePage();
    const selected = input.address.read().has("selected") ? next.selected : page.selected;
    if (canonicalRouteInput({ ...next, selected }) === canonicalRouteInput(page)) return;
    page = freezePage({ ...next, selected });
    gate.movePage(page, { kind: "human", source: "query", history: "replace" }); syncWork(); syncReads(); notify();
  });
  cleanups.push(stopAddress);
  const basisRefusal = () => {
    if (input.readOnly || input.history) return "needs live Revit";
    if(!edits) return "No Work declared";
    if(!key) return "Choose a Work member";
    const owner = [...owners.values()].find(o=>!o.ready);
    if (owner) return owner.problem ?? "Reading Work...";
    const core = spec.core ? reads.get(spec.core)?.snapshot : undefined;
    if (spec.core && !core?.current) return core?.reason ?? "Reading Value...";
    return [...owners.values()].some(o=>o.config.value && spec.core && canonicalRouteInput(o.doc)!==canonicalRouteInput(core?.value?.[o.config.value!])) ? "Refreshing Value after Work changed" : null;
  };
  const basis = () => {
    if (basisRefusal()) return null;
    if(renderedBasis && gate.current(renderedBasis)) return renderedBasis;
    const issued = gate.invocation(gate.capture("draw"), dependencies());
    return renderedBasis = issued.ok ? issued.value : null;
  };
  const entries = () => disposed ? [] : [...owners.values()].flatMap(o => o.lease.entry.journal.entries()).sort((a,b) => a.at-b.at);
  const submit = async (record: typeof owners extends Map<string, infer R> ? R : never, request: WorkWrite, token: InvocationToken) => {
    requireWritable();
    const result = await settleWork(door.submitWork(record.scope, request, token));
    if (result.kind !== "accepted") throw Error(result.kind === "refused" ? result.refusal.error : "Work write did not settle");
    const ack = result.ack;
    if (record.handle && ack.revision > record.handle.revision) {
      const applied = applyPatches(record.config.state, { version: 1, revision: record.handle.revision, doc: record.doc }, ack.by, ack.patches, ack.base, true, true);
      if (applied.ok) accept(record, { key: ack.key, revision: ack.revision }, applied.envelope.doc);
    }
    record.lease.entry.journal.accept(ack); notify();
    return { ok: true, revision: ack.revision, handle: { key: ack.key, revision: ack.revision }, write: ack } as const;
  };
  const restore = async (direction: "undo" | "redo", press?: string) => {
    const step = press ? entries().find(e => e.press === press) : entries().filter(e => e.state === (direction === "undo" ? "applied" : "undone")).at(-1);
    const record = [...owners.values()].find(o => o.lease.entry.journal.entries().some(e => e.press === step?.press));
    const token = basis();
    if (!record?.ready || !token) return { ok: false, code: "write-refused", message: basisRefusal() ?? "Work unavailable" } as const;
    return record.lease.entry.journal[direction](async request => {
      try { return await submit(record, request, token); }
      catch (error) { return { ok: false, kind: "refused", error: String(error), hint: "Read Work again" } as RouteStateWriteResult; }
    }, step?.press);
  };
  const history = { get entries() { return entries(); }, undo: (press?: string) => restore("undo",press),
    redo: (press?: string) => restore("redo",press), revert: async (press?: string) => {
      const record=[...owners.values()].find(o=>o.lease.entry.journal.read().undo.at(-1)?.press===(press??entries().filter(e=>e.state==="applied").at(-1)?.press));
      const step=record?.lease.entry.journal.read().undo.at(-1),token=basis();
      if(!record?.ready||!step||!token||step.barrier||step.superseded) throw Error("History step is blocked");
      return submit(record,{kind:"apply",expectedRevision:record.handle!.revision,press:crypto.randomUUID(),label:`Revert ${step.label}`,
        patches:step.transitions.slice(0,step.cursor).reverse().flatMap(t=>t.inverse)},token);
    } };
  const reviews = new Map<string, { preview: z.output<typeof writePreviewSchema>; input: Record<string, unknown>; token: InvocationToken; signature: string; presentation: any }>();
  const consentReviews = new Map<string, ReturnType<typeof reviews.get>>();
  const problems = new Map<string,string>();
  const plans = new Map<string,InvocationToken>();
  const workSignature = () => canonicalRouteInput([...owners].map(([id,o]) => [id,o.ready,o.handle]));
  // Plans seal Work, target and native reads, not the browser-owned Page pose (ADR 0033).
  const reviewCurrent = (id: string, token: InvocationToken, signature: string) =>
    !disposed && plans.get(id) === token && gate.read()?.scope === token.token.scope &&
    signature === workSignature() && Object.entries(token.dependencies).every(([key, hash]) => dependencies()[key] === hash);
  const staleReview = (token: InvocationToken, signature: string) => {
    const state = gate.read(), current = dependencies();
    const changed = [
      signature !== workSignature() && `Work readiness/handles ${signature} -> ${workSignature()}`,
      token.workRevision !== (state?.work?.revision ?? null) && `Work revision ${token.workRevision} -> ${state?.work?.revision ?? null}`,
      ...Object.entries(token.dependencies).flatMap(([key, hash]) => current[key] === hash ? [] : [`Value ${key} ${hash} -> ${current[key] ?? "unavailable"}`]),
    ].filter(Boolean);
    return Error(`Review is stale; prepare it again (${changed.join("; ") || "attempt retired"})`);
  };

  const subjectState = (search: Record<string,unknown>): SubjectState | null => {
    // URL pinning can leave the resolved target unchanged; custody owns the current Place.
    if (subjectScopeKey(search) !== subjectScopeKey(Object.fromEntries(input.address.read()))) return null;
    const refused = (refusal:string): SubjectState => ({ready:false,refusal,label:""});
    if (disposed || released || !input.custody.current()) return refused("Place is inactive or retired");
    try {
      const subjectSpec=spec.subject;
      if(!subjectSpec) {const link=input.address.read();link.delete("thread");link.delete("shell");return {ready:true,refusal:null,label:"",link:`${module.data.address}${link.size?`?${link}`:""}`};}
      const field = subjectSpec.field;
      const subject = spec.fields[field]!.schema.parse(search[field] === undefined ? page[field] : JSON.parse(String(search[field]))) as {kind:string;ids?:string[];active?:string};
      const core = reads.get(subjectSpec.read ?? spec.core!)?.snapshot;
      if (!core?.current) return refused(core?.reason ?? "Reading the subject roster");
      const options=subjectSpec.options(core.value), ids=subject.kind==="all"?options.map(o=>o.id):subject.ids??[];
      if (ids.some(id=>!options.some(o=>o.id===id))) return refused(`A ${spec.subject?.noun ?? "Subject"} in this link is not in this model; choose it again from the roster`);
      if (canonicalRouteInput(subject)!==canonicalRouteInput(page[field])) return null;
      const link = input.address.read();
      link.delete("thread"); link.delete("shell");
      if (!link.has(field)) link.set(field,JSON.stringify(page[field]));
      return {ready:true,refusal:null,label:ids.length===1?options.find(o=>o.id===ids[0])!.label:ids.length?`${ids.length} ${spec.subject?.noun ?? "Subject"}s`:"",link:`${module.data.address}?${link}`};
    } catch { return refused(`${spec.subject?.noun ?? "Subject"} is malformed`); }
  };
  const results = new Map<string,unknown>();
  const pending = new Set<string>();
  const run = async (id: string, apply = false, supplied?:unknown) => {
    requireWritable();
    if (input.fixture !== null) throw Error("Fixture has no native writes");
    const cmd = spec.commands[id];
    if(!cmd) throw Error(`Unknown command ${id}`);
    problems.delete(id); notify();
    if("kind" in cmd) {
      const queryPage = cmd.kind === "query" ? gate.read()?.pageEpoch : null;
      const handle=owners.get(own)?.handle ?? null;
      const context={page:page as never,target:input.target,work:handle,value:spec.core?reads.get(spec.core)?.snapshot.value:undefined};
      try {
        const proposed=cmd.input?.(context,supplied) ?? supplied ?? {};
        const catalog=commands[cmd.entry as keyof typeof commands];
        const request=cmd.contract.input.parse(catalog && "work" in catalog && catalog.work
          ? {...z.record(z.string(),z.unknown()).parse(proposed),work:handle} : proposed);
        let result:unknown;
        if(cmd.kind === "session" || cmd.kind === "catalog") {
          const completion=await settleNative(door.submit({id:crypto.randomUUID(),key:cmd.entry,
            target:commandTarget(cmd.entry,z.record(z.string(),z.unknown()).parse(request),input.target?.kind === "document"?input.target.ref:undefined),
            input:z.record(z.string(),z.unknown()).parse(request)}),true);
          const receipt=z.object({receiptId:z.string(),result:z.unknown().optional()}).parse(completion);
          result=catalog && "result" in catalog ? cmd.contract.output.parse(receipt.result) : {kind:"void",receiptId:receipt.receiptId};
        } else result=await cmd.invoke!(request,{target:input.target ?? {kind:"host"},work:handle});
        if (queryPage && (disposed || !input.custody.current() || gate.read()?.pageEpoch !== queryPage))
          throw Error("This read finished for an earlier Page; run it again");
        results.set(id,result); syncReads(true); return result;
      } catch(error) {problems.set(id,error instanceof Error?error.message:String(error));throw error;}
      finally {notify();}
    }
    if (apply) {
      const held = reviews.get(id);
      if (!held || !reviewCurrent(id, held.token, held.signature)) throw Error("Review is stale; prepare it again");
      consentReviews.set(id,held); reviews.delete(id); notify();
      try {
        const result = await settleNative(door.submit({ id: crypto.randomUUID(), key: cmd.entry, target: input.target!, input: held.input }));
        syncReads(true); return result;
      } finally {consentReviews.delete(id);notify();}
    }
    let token: InvocationToken | undefined;
    try {
      if (!basis() || [...owners.values()].some(o => !o.ready)) throw Error(basisRefusal() ?? "Work unavailable");
      const core = spec.core ? reads.get(spec.core)?.snapshot : undefined;
      if (!core?.current) throw Error(core?.reason ?? "Read the current Value before planning");
      const issued=gate.invocation(gate.capture(`plan:${id}`),dependencies());
      if(!issued.ok) throw Error(issued.reason);
      token=issued.value; plans.set(id,token); reviews.delete(id);
      const contract = commands[cmd.entry as keyof typeof commands];
      const primary = owners.get("work" in contract && contract.work ? contract.work.route : own)!.handle!;
      const proposed=cmd.input?.({page:page as never,target:input.target,work:primary,value:core.value},supplied) ?? supplied ?? {};
      const request = cmd.planContract.input.parse({ ...z.record(z.string(),z.unknown()).parse(proposed), work: primary,
        readWorks: Object.fromEntries([...owners].filter(([id]) => id !== primary.key.route).map(([id,o]) => [id,o.handle])) });
      const signature = workSignature();
      const data = spec.core ? reads.get(spec.core)?.snapshot.value : undefined, doc = owners.get(own)!.doc;
      const result = await settleNative(door.submit({ id: token.id, key: cmd.plan, target: input.target!, input: z.record(z.string(),z.unknown()).parse(request) }));
      const preview = writePreviewSchema.parse(cmd.planContract.output.parse(result));
      const handle = z.object({ handle: workHandleSchema }).parse(preview.seal.work).handle;
      if (canonicalRouteInput(handle) !== canonicalRouteInput(primary)) throw Error("Preview sealed a different Work");
      if (!reviewCurrent(id, token, signature)) throw staleReview(token, signature);
      const presented=presentationSchema.parse(cmd.present(preview,data,doc));
      reviews.set(id, { preview, input: request as Record<string,unknown>, token, signature,
        presentation: typeof presented === "string" ? {sentence:presented,rows:[]} : presented });
      problems.delete(id);
    } catch (error) { if(!token || plans.get(id)===token) problems.set(id,error instanceof Error?error.message:String(error)); throw error; }
    finally { notify(); }
  };
  syncReads();
  const mounted = {
    spec, data: module.data, subjectState, move,
    absentOwners:()=>[...owners].filter(([id,owner])=>id!==own&&owner.absent).map(([route])=>route),
    startAction():import("../route/typed-route").ActionHandle|null {
      if([...owners.values()].some(record=>!record.ready&&!record.absent)) return null;
      const absent=[...owners].filter(([,record])=>record.absent);
      if(!absent.length||!edits?.seed||!key||input.readOnly||input.history) return null;
      const selected=key;
      const refusal = () => mounted.available() ? null : "Reveal this Place before starting Work";
      const run=async()=>{
        if(pending.has("work.start")) throw Error("Start already pending");
        try {
          requireWritable();
          if(canonicalRouteInput(selected)!==canonicalRouteInput(selectedKey())) throw Error("Selected Work changed; Start the current member");
          pending.add("work.start");problems.delete("work.start");notify();
          const requests=absent.map(([id,record])=>commands["work.start"].input.parse({key:record.scope.key,
            seed:id===own?edits.seed!(page as never,input.target):record.config.state.schema.parse({})}));
          for(const request of requests){
            requireWritable();
            const started=z.object({ok:z.literal(true),handle:workHandleSchema,doc:z.json()}).parse(
              await settleNative(door.submit({id:crypto.randomUUID(),key:"work.start",target:{kind:"host"},input:request})));
            requireWritable();
            const record=owners.get(request.key.route);
            if(!record) throw Error("Started Work no longer belongs to this route");
            accept(record,started.handle,started.doc);
          }
          if(canonicalRouteInput(selected)!==canonicalRouteInput(selectedKey())) return;
          syncReads(true);
        } catch(error){problems.set("work.start",error instanceof Error?error.message:String(error));throw error;}
        finally{pending.delete("work.start");notify();}
      };
      return {label:"Start",get pending(){return pending.has("work.start");},get refusal(){return refusal();},
        get failure(){return problems.get("work.start")??null;},
        get consent(){return writeReject(mounted.timeline(),["work.start"],(thread,request)=>void harnessClient(resolveWorkbenchConfig().origin).permission(thread,request,"stop_writes"));},
        run,plan:run,apply:run,cancel:()=>{},read:()=>null};
    },
    action(id: string): import("../route/typed-route").ActionHandle {
      const command=spec.commands[id];
      if(!command) throw Error(`Unknown command ${id}`);
      const perform=async(apply=false,supplied?:unknown)=>{
        if(pending.has(id)) throw Error("Action already pending");
        pending.add(id); notify();
        try { return await run(id,apply,supplied); }
        catch(error) { problems.set(id,error instanceof Error?error.message:String(error)); throw error; }
        finally {pending.delete(id);notify();}
      };
      return {label:command.label, get pending(){return pending.has(id);},
        get refusal(){return mounted.commandRefusal(id);}, get failure(){return problems.get(id)??null;},
        get consent(){return writeReject(mounted.timeline(),[command.entry],(thread,request)=>void harnessClient(resolveWorkbenchConfig().origin).permission(thread,request,"stop_writes"));},
        run:(supplied)=>perform(false,supplied),plan:()=>perform(),apply:()=>perform(true),
        cancel:()=>mounted.cancel(id),read:()=>mounted.review(id)};
    },
    journal: () => {
      const journals=[...owners.values()].map(o=>o.lease.entry.journal.read()),base=owners.get(own)?.lease.entry.journal.read() ?? {revision:null,from:0,busy:false,receipts:[],undo:[],redo:[],moves:[],last:null};
      return freezePage({...base, undo:journals.flatMap(j=>j.undo).sort((a,b)=>a.at-b.at), redo:journals.flatMap(j=>j.redo).sort((a,b)=>a.at-b.at),
        intents:journals.flatMap(j=>j.intents), moves:journals.flatMap(j=>j.moves).sort((a,b)=>a.at-b.at), last:journals.flatMap(j=>j.last?[j.last]:[]).sort((a,b)=>a.step.at-b.step.at).at(-1)??null});
    },
    discardIntent(id: string) { for (const owner of owners.values()) owner.lease.entry.journal.discardIntent(id); notify(); },
    restoreWork: restore, journalRefusal: () => input.readOnly || input.history ? "needs live Revit" : [...owners.values()].some(o=>!o.ready)?"Work unavailable":null,
    stopCommand: (id:string) => {requireWritable();return cancelAction(id);},
    attention: {
      write: (page:object) => Object.fromEntries(Object.keys(spec.fields).map(key=>[key,JSON.stringify((page as Record<string,unknown>)[key])])),
      read: (patch:Record<string,string>) => Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,(()=>{const field=spec.fields[key];if(!field) throw Error(`${key} is not an attention field`);return field.schema.parse(JSON.parse(value));})()])),
    }, current: (token:InvocationToken) => gate.current(token),
    value: (read: import("../route/host-read").HostRead | undefined = spec.core) => read ? reads.get(read)?.snapshot ?? unavailable(read.demand === "explicit"?"Press Read":"Reading...") : unavailable("No read declared"),
    owner: (id = own) => owners.get(id),
    page: { read: () => page, pose: (patch: any, intent?: "gesture"|"named") => moveRole("pose",patch,intent === "gesture"?"replace":intent === "named"?"push":undefined), query: (patch: any) => moveRole("query",patch), select: (selected: any) => move({selected}), subject: (subject: any) => {if(!spec.subject) throw Error("No subject declared");return move({ [spec.subject.field]: subject },"push");} },
    subscribe(listener: () => void) { released = false; listeners.add(listener); syncReads(); return () => { listeners.delete(listener); }; },
    available: () => !disposed && input.custody.current(), target: () => input.target, revision: () => revision, work: () => gate.read()?.work ?? null, workBasis: basis, history,
    commandRefusal:(id:string)=> input.readOnly || input.history ? "needs live Revit" : input.fixture !== null ? "Fixture has no native actions" : "kind" in spec.commands[id]! ? null : basisRefusal(),
    problem: () => edits?basisRefusal():null, writeRefusal: () => input.fixture !== null ? "Fixture has no native writes" : basisRefusal(),
    refresh: (read?:import("../route/host-read").HostRead) => {
      requireCurrent(); for(const selected of read?[read]:allReads) demanded.add(selected); syncReads(true);
    }, run, result:(id:string)=>results.get(id),
    review: (id: string) => { const r=reviews.get(id)??consentReviews.get(id); if(!r) return null;
      const stale = !reviewCurrent(id, r.token, r.signature);
      return { preview: stale || !reviews.has(id) ? undefined : r.preview, sentence: stale ? null : r.presentation.sentence,
        rows: stale ? [] : r.presentation.rows, cells: stale ? [] : r.presentation.cells, stale }; },
    reviewProblem: (id: string) => problems.get(id) ?? null,
    cancel: (id: string) => { const token=plans.get(id);if(token) gate.retire(token.token);plans.delete(id);reviews.delete(id);notify(); },
    timeline: () => [...owners.values()].flatMap(o => o.lease.entry.timeline()),
    draw(id: string, render?: (ctx: DrawContext<any,any,any,any>)=>unknown) {
      const pane = spec.panes[id]!;
      const value = pane.read ? reads.get(pane.read)?.snapshot ?? unavailable(pane.read.demand === "explicit"?"Press Read":"Reading...") : unavailable("No read declared");
      const core = spec.core ? reads.get(spec.core)?.snapshot ?? unavailable("Reading...") : unavailable("No read declared");
      const token = basis();
      const drawnOwners = new Map(owners);
      const handles = new Map([...owners].map(([id,o]) => [id,o.handle]));
      const docs = new Map([...owners].map(([id,o]) => [id,o.doc]));
      const ready = !!token && (!pane.read || value.current);
      const refusal = ready ? null : basisRefusal() ?? (!value.current ? value.reason : "Read the current Value before editing");
      const ownerOf = (path: readonly string[], preferred?: string) => {
        const id = preferred ?? (Object.hasOwn(edits!.work.schema.shape,path[0]!) ? own : [...owners].find(([,o]) => Object.hasOwn(o.config.state.schema.shape,path[0]!))?.[0]);
        if (!id || !owners.has(id) || !Object.hasOwn(owners.get(id)!.config.state.schema.shape,path[0]!)) throw Error(`No owning Work for ${path.join(".")}`);
        return id;
      };
      const patch = async (request: readonly RouteStatePatch[] | (()=>readonly RouteStatePatch[]), detail: EditHistory = {label:"Edit"}, preferred?: string): Promise<EditFailure> => {
        if (!ready || !token) return {code:"unavailable",message:refusal ?? "Read the current Value before editing"};
        try {
          const patches = typeof request === "function" ? request() : request;
          const groups = new Map<string,RouteStatePatch[]>();
          for (const p of patches) { const id=ownerOf(p.path.map(String),preferred); groups.set(id,[...(groups.get(id)??[]),p]); }
          await Promise.all([...groups].map(async ([id, patches]) => {
            const record=drawnOwners.get(id)!, handle=handles.get(id)!;
            const applied=applyPatches(record.config.state,{version:1,revision:handle.revision,doc:docs.get(id)},"human",patches,handle.revision,false,true);
            if (!applied.ok) throw Error(applied.error);
            // Scalar cells travel whole; record cells keep their narrow keys (host inverse authority).
            const normalized=[...new Set(patches.map(p=>String(p.path[0])))].flatMap(key => bare(record.config.state.schema.shape[key]!) instanceof z.ZodRecord
              ? patches.filter(p=>String(p.path[0])===key) : [{path:[key],value:(applied.envelope.doc as any)[key]}]);
            const label=id===own ? detail.label : `${detail.label} · from /${id}`;
            const write:WorkWrite={kind:"apply",expectedRevision:handle.revision,press:crypto.randomUUID(),patches:normalized,...z.object({label:z.string(),meta:z.json().optional()}).parse(edits!.describe({...detail,label}))};
            const journal=record.lease.entry.journal, intent=journal.retainIntent(write,label);
            notify();
            try {
              requireWritable();
              if (!basis() || !gate.current(token)) throw Error("Stale accepted Work basis");
              if (owners.get(id)!==record || !record.ready || canonicalRouteInput(record.handle)!==canonicalRouteInput(handle)) throw Error("Owning Work changed since this cell was drawn");
              await submit(record,write,token);
              journal.discardIntent(intent);
            } catch(error) {
              journal.refuseIntent(intent,error instanceof Error?error.message:String(error));
              throw error;
            } finally { notify(); }
          }));
          return null;
        } catch(error) { return {code:"refused",message:error instanceof Error?error.message:String(error)}; }
      };
      const cells: DrawContext<any, any, any, any>["cells"] = {
        doc: owners.get(own)?.doc ?? null, basis: token, ready, refusal, history,
        owner(path) { const route=ownerOf(path); return {route,label:route===own?"Work":`from /${route}`}; },
        at(path,preferred,facts={}) {
          const route=ownerOf(path,preferred), address=[...path];
          const value=address.reduce((doc,key)=>doc?.[key],owners.get(route)!.doc)??{};
          const cellPatch=(patches: readonly RouteStatePatch[],detail?:EditHistory) => facts.readOnly
            ? Promise.resolve({code:"read-only",message:"This cell is read-only"}) : patch(patches,detail,route);
          const clear=(detail?:EditHistory)=>cellPatch(cellPatches(address.slice(0,-1),address.at(-1)!,value,{kind:"clear"}),detail);
          const record=owners.get(route)!;
          const accepted = value.edit;
          const accept=(detail?:EditHistory) => {
            if(!accepted) return Promise.resolve({code:"not-staged",message:"This cell is no longer staged"});
            const {by:_by,at:_at,base:_base,...rung}=accepted;
            return cellPatch([{path:[...address,"edit"],value:rung}],detail);
          };
          // A cell may undo only a press whose entire footprint is this address.
          const step=record.lease.entry.journal.read().undo.findLast(step=>!step.barrier&&!step.superseded&&step.transitions.every(t=>t.paths.every(p=>address.every((key,i)=>String(p[i])===key))));
          const undo=async():Promise<EditFailure>=>{
            if(!ready||!token||!gate.current(token)||canonicalRouteInput(record.handle)!==canonicalRouteInput(handles.get(route))) return {code:"stale-cell",message:"Owning Work changed since this cell was drawn"};
            if(!step) return {code:"no-cell-undo",message:"No isolated edit for this cell"};
            const result=await restore("undo",step.press);
            return result.ok?null:{code:"undo-refused",message:"message" in result?String(result.message):"Cell undo refused"};
          };
          return {owner:{route,label:route===own?"Work":`from /${route}`},value, facts:{...facts,baseline:facts.baseline??value.base?.value},
            freshness:ready?"current":owners.get(route)!.doc===null&&core.value===undefined?"never":"stale", refusal: facts.readOnly ? "This cell is read-only" : refusal, clear, accept,deny:clear,undo,
            delete:(detail)=>cellPatch([{path:address}],detail),
            stage:(value2,detail)=> facts.readOnly ? Promise.resolve({code:"read-only",message:"This cell is read-only"}) :
              patch(cellPatches(address.slice(0,-1),address.at(-1)!,value,
                Object.hasOwn(facts,"baseline")&&canonicalRouteInput(value2)===canonicalRouteInput(facts.baseline)?{kind:"clear"}:{kind:"set",rung:{value:value2}}),detail,route),
            transitions:(detail)=>!ready?[]:[...(value.edit?[{kind:"clear" as const,run:()=>clear(detail)},...(value.edit.by==="pea"?[{kind:"take" as const,run:()=>accept(detail)},{kind:"unsuggest" as const,run:()=>clear(detail)}]:[])]:[]),...(step?[{kind:"undo" as const,run:undo}]:[])]};
        },
        label(input,label) { const foreign=[...new Set(edits!.patches(input,core.value).map(p=>ownerOf(p.path.map(String))))].filter(id=>id!==own); return foreign.length?`${label} · ${foreign.map(id=>`from /${id}`).join(", ")}`:label; },
        patch,
        edit: (edit,detail)=>patch(()=>edits!.patches(edits!.input.parse(edit),core.value),detail),
      };
      return (render ?? pane.draw)({ target: input.target, refresh:mounted.refresh, read:(read:import("../route/host-read").HostRead)=>mounted.value(read), value, page: mounted.page, cells, selection:{read:()=>page.selected,set:(selected:any)=>move({selected})},
        write:mounted.action } as any);
    },
    // Retaining hidden read connections was a Plan-identity workaround; content fingerprints
    // now survive reconnect. Keep Work journals/receipts connected so pending edits settle.
    // Read release preserves write authority; disposal and Place custody fence writes.
    release() { released = true; for (const r of reads.values()) { r.args=""; r.stop(); } },
    dispose() { if (disposed) return; disposed=true; cleanups.splice(0).reverse().forEach(stop => stop()); listeners.clear(); },
  };
  const stopSubject=observeSubject(spec.key,{current:()=>!disposed&&!released&&input.custody.current(),read:subjectState,subscribe:mounted.subscribe});
  cleanups.push(stopSubject);
  return mounted;
  } catch (error) { cleanups.reverse().forEach(stop => stop()); throw error; }
}
export type TypedMount = ReturnType<typeof mountTypedRoute>;
async function settleNative(submission: ReturnType<WorkJournalDoor["submit"]>,receipt=false) {
  return new Promise<unknown>((resolve,reject)=>submission.accepted.subscribe(outcome=>{
    if(outcome.kind==="pending") return;
    if(outcome.kind==="accepted-native"&&outcome.outcome==="committed") resolve(receipt?{receiptId:outcome.receiptId,result:outcome.result}:outcome.result);
    else reject(Error(outcome.kind==="rejected"?outcome.problem:"Outcome unknown; inspect History"));
  },()=>reject(Error("Command detached; inspect History before retrying"))));
}
