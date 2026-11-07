import { z } from "zod";
import { applyPatches, bindWork, cellPatches, commands, canonicalRouteInput, workKey,
  writePreviewSchema, presentationSchema, workHandleSchema, workFeedFailureMessage, type WorkFeedFailure, type WorkHandle, type WorkWrite, type RouteStatePatch,
  type RouteStateWriteResult } from "@pe/agent-contracts";
import { createRouteScopeGate } from "@pe/runtime/route-scope-gate";
import { applicationWorkRegistry, createApplicationWorkRegistry } from "./application-work-registry";
import { createWorkFeedClient } from "./work-feed-client";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { settleWork } from "./work-door-observation";
import { freezePage } from "./page-port";
import { bare } from "@pe/agent-contracts";
import type { WorkJournalDoor, WorkScope } from "@pe/agent-contracts";
import type { RouteFingerprint } from "@pe/agent-contracts";
import type { InvocationToken } from "@pe/agent-contracts";
import type { PlaceInput } from "./admitted-place";
import type { ReadingContext, ReadingSource } from "./readings";
import type { DrawContext, EditFailure, EditHistory, TypedRoute } from "../route/typed-route";
import { cancelAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { observeSubject, subjectScopeKey, type SubjectState } from "./subject";

type Value = DrawContext<any, any, any, any>["value"];
const unavailable = (reason: string, value?: any, publication: Value["publication"] = null): Extract<Value,{current:false}> =>
  ({ current: false, status: "unavailable", reason, publication, ...(value === undefined ? {} : { value }) });

/** Typed routes execute declarations directly. No graph admission, body slots or reading scheduler. */
export function mountTypedRoute(module: TypedRoute, input: PlaceInput, fingerprint: RouteFingerprint,
  ports: { work?: WorkJournalDoor; sources?: Record<string, ReadingSource> } = {}) {
  const { spec } = module;
  const own = spec.edits.work.route;
  const registry = input.fixture === null ? applicationWorkRegistry : createApplicationWorkRegistry();
  const listeners = new Set<() => void>();
  let revision = 0, disposed = false, released = false;
  const notify = () => { if (!disposed) { revision++; listeners.forEach(f => f()); } };
  const requireCurrent = () => {
    if (disposed || released || !input.custody.current() || !input.target) throw Error("Place is not writable");
  };
  const decodePage = () => {
    const search = input.address.read();
    return freezePage({ ...Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => {
      const raw = search.get(key);
      return [key, field.schema.parse(raw === null ? field.initial : JSON.parse(raw))];
    })), selected: [] });
  };
  const owners = new Map<string, {
    scope: WorkScope; config: typeof spec.edits.owners[string]; handle: WorkHandle | null;
    doc: any; ready: boolean; problem: string | null; failure: WorkFeedFailure | null;
    lease: ReturnType<typeof registry.acquire>; stop(): void;
  }>();
  let page: Record<string, any> = decodePage();
  const key = bindWork(own, input.work.address, input.address.read().get("work") || undefined, input.work.open ?? undefined);
  const reads = new Map<import("../route/host-read").HostRead, { snapshot: Value; stop(): void }>();
  const dependencies = () => Object.fromEntries([...reads].filter(([,r])=>r.snapshot.current).map(([read,r])=>[read.key,r.snapshot.current?r.snapshot.hash??"":""]));
  const gate = createRouteScopeGate({
    workSchema: spec.edits.work.schema, hashWork: canonicalRouteInput,
    journal: key => owners.get(key.route)!.lease.entry.journal,
    dependencies,
    preparePage: (_page, patch) => ({ ok: true, value: { page: patch, changed: true, membership: "unresolved" } }),
  });
  gate.enter({ target: input.target, work: key }, page);
  let workAttempt = gate.capture("work");
  let door = ports.work ?? createWorkFeedClient();
  if (input.fixture !== null) {
    const packet = spec.core.source.provide?.(input.fixture, spec.core.args(page as never));
    if (!packet?.value) throw Error(`Missing fixture ${input.fixture}`);
    const data = packet.value.data as Record<string,unknown>;
    door = createFixtureWorkDoor(spec.edits.work, data[spec.edits.owners[own]!.value],
      Object.fromEntries(Object.entries(spec.edits.owners).map(([id,c]) => [`owner:${id}`,c.state.schema])),
      Object.fromEntries(Object.entries(spec.edits.owners).map(([id,c]) => [id,data[c.value]])),
      Object.fromEntries(Object.keys(spec.edits.owners).map(id => [`owner:${id}`,id])));
  }
  const accept = (record: typeof owners extends Map<string, infer R> ? R : never, handle: WorkHandle, doc: unknown) => {
    if (record.handle && handle.revision < record.handle.revision) return;
    if(workKey(handle.key)!==workKey(record.scope.key)) throw Error("Work snapshot belongs to another Work");
    const parsed = record.config.state.schema.parse(doc);
    if (record.handle?.revision === handle.revision && canonicalRouteInput(record.doc) !== canonicalRouteInput(parsed))
      throw Error("Contradictory Work revision; refresh this route");
    record.handle = freezePage(handle); record.doc = freezePage(parsed); record.ready = true; record.problem = null; record.failure = null;
    record.lease.entry.journal.observe({ revision: handle.revision, doc: parsed });
    if (handle.key.route === own) gate.acceptWork(workAttempt,
      { kind: "snapshot", handle, value: parsed, hash: canonicalRouteInput(parsed) });
  };
  for (const [id, config] of Object.entries(spec.edits.owners)) {
    const scope: WorkScope = { route: spec.key, fingerprint, key: { ...key, route: id },
      target: input.target, subject: null, ...(id === own ? {} : { reading: `owner:${id}` }) };
    const lease = registry.acquire(scope.key);
    const record = { scope, config, handle: null as WorkHandle | null, doc: null as any,
      ready: false, problem: null as string | null, failure: null as WorkFeedFailure | null, lease, stop: () => {} };
    owners.set(id, record);
    lease.entry.connect(scope, door);
    const stopJournal = lease.entry.subscribe(notify);
    const stopFeed = door.open(scope).subscribe(state => {
      if (disposed) return;
      try {
        if (state.kind === "ready") {
          accept(record, state.snapshot.handle, state.snapshot.value);
          lease.entry.restore(state);
        } else if (state.kind === "ack" && record.handle) {
          const ack = state.ack;
          if (ack.revision > record.handle.revision) {
            const result = applyPatches(config.state, { version: 1, revision: record.handle.revision, doc: record.doc },
              ack.by, ack.patches, ack.base, true, true);
            if (!result.ok) throw Error(result.error);
            accept(record, { key: ack.key, revision: ack.revision }, result.envelope.doc);
          }
          lease.entry.journal.accept(ack);
        } else if (state.kind !== "ack") {
          record.ready = false;
          record.failure=state.kind === "failed"?state.failure:null;
          record.problem = record.failure ? workFeedFailureMessage(record.failure) : "Reading Work...";
        }
      } catch (error) { record.ready = false; record.problem = String(error); }
      notify();
    }, notify);
    record.stop = () => { stopFeed(); stopJournal(); lease.release(); };
  }
  const readArgs = () => spec.core.input.parse(spec.core.args(page as never));
  let argsKey = "";
  const syncReads = (force = false) => {
    if (disposed || released) return;
    const args = readArgs(), signature = canonicalRouteInput(args);
    if (!force && signature === argsKey) return;
    argsKey = signature;
    for (const read of new Set([spec.core, ...Object.values(spec.panes).map(p => p.read)])) {
      const previous = reads.get(read)?.snapshot.value;
      reads.get(read)?.stop();
      const controller = new AbortController();
      const record: {snapshot:Value;stop():void} = { snapshot: { ...unavailable("Reading...", previous),status:"pending" }, stop: () => controller.abort() };
      reads.set(read, record);
      const deliver = (frame: Parameters<Extract<ReadingSource, { kind: "use" | "feed" }>["open"]>[1] extends (arg: infer P) => any ? P : never) => {
        if (controller.signal.aborted || disposed || reads.get(read) !== record) return;
        if (frame.kind === "complete" || frame.kind === "part") {
          try {
            const packet = read.output.parse(frame.value);
            const current = frame.kind === "complete" && frame.fresh !== false && packet.state === "current" &&
              !!packet.value && !packet.value.coverage.unknown.length && !packet.value.coverage.refused.length;
            record.snapshot = current ? { status: "ready", current: true, value: freezePage(packet.value!.data), publication: freezePage(packet.value), hash: packet.value!.evaluation }
              : unavailable(frame.reason ?? packet.reason ?? "Incomplete Value", packet.value?.data, freezePage(packet.value));
          } catch (error) { record.snapshot = unavailable(String(error), record.snapshot.value, record.snapshot.publication); }
        } else if (frame.kind !== "log") record.snapshot = unavailable(frame.kind === "failure" ? String(frame.error) : "Reading...", record.snapshot.value, record.snapshot.publication);
        notify();
      };
      if (input.fixture !== null) {
        try { deliver({ kind: "complete", value: read.source.provide!(input.fixture, args), revision: 1 }); }
        catch (error) { deliver({ kind: "failure", error }); }
      } else {
        const ctx: ReadingContext = { target: input.target!, workKey: key, workRevision: null,
          work: null, page, args, signal: controller.signal, inputs: {},
          attempt: { target: input.target!, workKey: key, generation: revision }, trigger: { kind: "demand" } };
        const source = ports.sources?.[read.key] ?? read.source;
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
      if (key !== "selected") spec.fields[key]!.schema.parse(value);
    }
    if(canonicalRouteInput(next)===canonicalRouteInput(page)) return {kind:"accepted",changed:false} as const;
    history ??= Object.keys(patch).some(key=>spec.fields[key]?.url==="push") ? "push" : "replace";
    page = freezePage(next);
    gate.movePage(page, { kind: "human", source: "query", history: "replace" });
    syncReads(); notify();
    const search = input.address.read();
    for (const [key,value] of Object.entries(patch)) if (key !== "selected") search.set(key, JSON.stringify(value));
    input.address.write(search, history);
    return { kind: "accepted", changed: true } as const;
  };
  const stopAddress = input.address.subscribe(() => {
    const next = decodePage();
    if (canonicalRouteInput({ ...next, selected: page.selected }) === canonicalRouteInput(page)) return;
    page = freezePage({ ...next, selected: page.selected });
    gate.movePage(page, { kind: "human", source: "query", history: "replace" }); syncReads(); notify();
  });
  let renderedBasis: InvocationToken | null = null;
  const basis = () => {
    if (!owners.get(own)?.ready) return null;
    if(renderedBasis && gate.current(renderedBasis)) return renderedBasis;
    const issued = gate.invocation(gate.capture("draw"), dependencies());
    return renderedBasis = issued.ok ? issued.value : null;
  };
  const entries = () => [...owners.values()].flatMap(o => o.lease.entry.journal.entries()).sort((a,b) => a.at-b.at);
  const submit = async (record: typeof owners extends Map<string, infer R> ? R : never, request: WorkWrite, token: InvocationToken) => {
    requireCurrent();
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
    if (!record?.ready || !token) return { ok: false, code: "write-refused", message: "Work unavailable" } as const;
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
  const problems = new Map<string,string>();
  const plans = new Map<string,InvocationToken>();
  const workSignature = () => canonicalRouteInput([...owners].map(([id,o]) => [id,o.ready,o.handle]));
  const scopeKey = subjectScopeKey(Object.fromEntries(input.address.read()));
  const subjectState = (search: Record<string,unknown>): SubjectState | null => {
    if (subjectScopeKey(search) !== scopeKey) return null;
    const refused = (refusal:string): SubjectState => ({ready:false,refusal,label:""});
    if (disposed || released || !input.custody.current()) return refused("Place is inactive or retired");
    try {
      const field = spec.subject.field;
      const subject = spec.fields[field]!.schema.parse(search[field] === undefined ? page[field] : JSON.parse(String(search[field]))) as {kind:string;ids?:string[];active?:string};
      const core = reads.get(spec.core)?.snapshot;
      if (!core?.value) return refused("Reading the subject roster");
      const options=spec.subject.options(core.value), ids=subject.kind==="all"?options.map(o=>o.id):subject.ids??[];
      if (ids.some(id=>!options.some(o=>o.id===id))) return refused(`A ${spec.subject.noun} in this link is not in this model; choose it again from the roster`);
      if (canonicalRouteInput(subject)!==canonicalRouteInput(page[field])) return null;
      return {ready:true,refusal:null,label:ids.length===1?options.find(o=>o.id===ids[0])!.label:ids.length?`${ids.length} ${spec.subject.noun}s`:"",link:`/${spec.key}?${input.address.read()}`};
    } catch { return refused(`${spec.subject.noun} is malformed`); }
  };
  const run = async (id: string, apply = false) => {
    requireCurrent();
    if (input.fixture !== null) throw Error("Fixture has no native writes");
    const cmd = spec.commands[id];
    if(!cmd) throw Error(`Unknown command ${id}`);
    problems.delete(id); notify();
    if (apply) {
      const held = reviews.get(id);
      if (!held || held.signature !== workSignature() || !gate.current(held.token)) throw Error("Review is stale; prepare it again");
      reviews.delete(id); notify();
      const result = await settleNative(door.submit({ id: crypto.randomUUID(), key: cmd.entry, target: input.target!, input: held.input }));
      syncReads(true); return result;
    }
    let token: InvocationToken | undefined;
    try {
      if (!basis() || [...owners.values()].some(o => !o.ready)) throw Error("Work unavailable; wait for the owning Work feed");
      const issued=gate.invocation(gate.capture(`plan:${id}`),dependencies());
      if(!issued.ok) throw Error(issued.reason);
      token=issued.value; plans.set(id,token); reviews.delete(id);
      const contract = commands[cmd.entry as keyof typeof commands];
      const primary = owners.get("work" in contract && contract.work ? contract.work.route : own)!.handle!;
      const request = cmd.planContract.input.parse({ work: primary,
        readWorks: Object.fromEntries([...owners].filter(([id]) => id !== primary.key.route).map(([id,o]) => [id,o.handle])) });
      const signature = workSignature();
      const data = reads.get(spec.core)?.snapshot.value, doc = owners.get(own)!.doc;
      const result = await settleNative(door.submit({ id: token.id, key: cmd.plan, target: input.target!, input: z.record(z.string(),z.unknown()).parse(request) }));
      const preview = writePreviewSchema.parse(cmd.planContract.output.parse(result));
      const handle = z.object({ handle: workHandleSchema }).parse(preview.seal.work).handle;
      if (canonicalRouteInput(handle) !== canonicalRouteInput(primary)) throw Error("Preview sealed a different Work");
      if (signature !== workSignature() || !gate.current(token)) throw Error("Review is stale; prepare it again");
      const presented=presentationSchema.parse(cmd.present(preview,data,doc));
      reviews.set(id, { preview, input: request as Record<string,unknown>, token, signature,
        presentation: typeof presented === "string" ? {sentence:presented,rows:[]} : presented });
      problems.delete(id);
    } catch (error) { if(!token || plans.get(id)===token) problems.set(id,error instanceof Error?error.message:String(error)); throw error; }
    finally { notify(); }
  };
  syncReads();
  const mounted = {
    spec, subjectState, move,
    journal: () => {
      const journals=[...owners.values()].map(o=>o.lease.entry.journal.read()),base=owners.get(own)!.lease.entry.journal.read();
      return {...base, undo:journals.flatMap(j=>j.undo).sort((a,b)=>a.at-b.at), redo:journals.flatMap(j=>j.redo).sort((a,b)=>a.at-b.at),
        moves:journals.flatMap(j=>j.moves).sort((a,b)=>a.at-b.at), last:journals.flatMap(j=>j.last?[j.last]:[]).sort((a,b)=>a.step.at-b.step.at).at(-1)??null};
    },
    restoreWork: restore, journalRefusal: () => [...owners.values()].some(o=>!o.ready)?"Work unavailable":null,
    stopCommand: (id:string) => {requireCurrent();return cancelAction(id);},
    attention: {
      write: (page:object) => Object.fromEntries(Object.keys(spec.fields).map(key=>[key,JSON.stringify((page as Record<string,unknown>)[key])])),
      read: (patch:Record<string,string>) => Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,spec.fields[key]!.schema.parse(JSON.parse(value))])),
    }, current: (token:InvocationToken) => gate.current(token),
    value: (read: import("../route/host-read").HostRead = spec.core) => reads.get(read)?.snapshot ?? unavailable("Reading..."),
    owner: (id = own) => owners.get(id),
    page: { read: () => page, pose: (patch: any, intent?: "gesture"|"named") => move(patch,intent === "gesture"?"replace":intent === "named"?"push":undefined), query: (patch: any) => move(patch), select: (selected: any) => move({selected}), subject: (subject: any) => move({ [spec.subject.field]: subject },"push") },
    subscribe(listener: () => void) { released = false; listeners.add(listener); syncReads(); return () => { listeners.delete(listener); }; },
    revision: () => revision, work: () => gate.read()?.work ?? null, workBasis: basis, history,
    problem: () => [...owners.values()].find(o => !o.ready)?.problem ?? null,
    refresh: () => syncReads(true), run,
    review: (id: string) => { const r=reviews.get(id); if(!r) return null;
      const stale = r.signature !== workSignature() || !gate.current(r.token);
      return { preview: stale ? undefined : r.preview, sentence: stale ? null : r.presentation.sentence,
        rows: stale ? [] : r.presentation.rows, cells: stale ? [] : r.presentation.cells, stale }; },
    reviewProblem: (id: string) => problems.get(id) ?? null,
    cancel: (id: string) => { const token=plans.get(id);if(token) gate.retire(token.token);plans.delete(id);reviews.delete(id);notify(); },
    timeline: () => [...owners.values()].flatMap(o => o.lease.entry.timeline()),
    draw(id: string) {
      const pane = spec.panes[id]!;
      const value = reads.get(pane.read)?.snapshot ?? unavailable("Reading...");
      const core = reads.get(spec.core)?.snapshot ?? unavailable("Reading...");
      const token = basis();
      const handles = new Map([...owners].map(([id,o]) => [id,o.handle]));
      const ready = !!token && value.current && core.current && [...owners.values()].every(o => o.ready && canonicalRouteInput(o.doc) === canonicalRouteInput(core.value?.[o.config.value]));
      const ownerOf = (path: readonly string[], preferred?: string) => {
        const id = preferred ?? (Object.hasOwn(spec.edits.work.schema.shape,path[0]!) ? own : [...owners].find(([,o]) => Object.hasOwn(o.config.state.schema.shape,path[0]!))?.[0]);
        if (!id || !owners.has(id) || !Object.hasOwn(owners.get(id)!.config.state.schema.shape,path[0]!)) throw Error(`No owning Work for ${path.join(".")}`);
        return id;
      };
      const patch = async (patches: readonly RouteStatePatch[], detail: EditHistory = {label:"Edit"}, preferred?: string): Promise<EditFailure> => {
        if (!ready || !token) return {code:"unavailable",message:"Read the current Value and Work before editing"};
        try {
          requireCurrent();
          if (!gate.current(token)) throw Error("Stale accepted Work basis");
          const groups = new Map<string,RouteStatePatch[]>();
          for (const p of patches) { const id=ownerOf(p.path.map(String),preferred); groups.set(id,[...(groups.get(id)??[]),p]); }
          await Promise.all([...groups].map(async ([id, patches]) => {
            const record=owners.get(id)!, handle=handles.get(id)!;
            if (!record.ready || canonicalRouteInput(record.handle) !== canonicalRouteInput(handle)) throw Error("Owning Work changed since this cell was drawn");
            const applied=applyPatches(record.config.state,{version:1,revision:handle.revision,doc:record.doc},"human",patches,handle.revision,false,true);
            if (!applied.ok) throw Error(applied.error);
            // Scalar cells travel whole; record cells keep their narrow keys (host inverse authority).
            const normalized=[...new Set(patches.map(p=>String(p.path[0])))].flatMap(key => bare(record.config.state.schema.shape[key]!) instanceof z.ZodRecord
              ? patches.filter(p=>String(p.path[0])===key) : [{path:[key],value:(applied.envelope.doc as any)[key]}]);
            const label=id===own ? detail.label : `${detail.label} · from /${id}`;
            await submit(record,{kind:"apply",expectedRevision:handle.revision,press:crypto.randomUUID(),patches:normalized,...z.object({label:z.string(),meta:z.json().optional()}).parse(spec.edits.describe({...detail,label}))},token);
          }));
          return null;
        } catch(error) { return {code:"refused",message:error instanceof Error?error.message:String(error)}; }
      };
      const cells: DrawContext<any, any, any, any>["cells"] = {
        doc: owners.get(own)!.doc, basis: token, ready, history,
        owner(path) { const route=ownerOf(path); return {route,label:route===own?"Work":`from /${route}`}; },
        at(path,preferred) {
          const route=ownerOf(path,preferred), address=[...path];
          const value=address.reduce((doc,key)=>doc?.[key],owners.get(route)!.doc)??{};
          const clear=(detail?:EditHistory)=>patch(cellPatches(address.slice(0,-1),address.at(-1)!,value,{kind:"clear"}),detail,route);
          return {owner:{route,label:route===own?"Work":`from /${route}`},value, clear,
            stage:(value2,detail)=>patch(cellPatches(address.slice(0,-1),address.at(-1)!,value,{kind:"set",rung:{value:value2}}),detail,route),
            transitions:(detail)=>ready&&value.edit?[{kind:"clear",run:()=>clear(detail)}]:[]};
        },
        label(input,label) { const foreign=[...new Set(spec.edits.patches(input,core.value).map(p=>ownerOf(p.path.map(String))))].filter(id=>id!==own); return foreign.length?`${label} · ${foreign.map(id=>`from /${id}`).join(", ")}`:label; },
        edit: (edit,detail)=>patch(spec.edits.patches(spec.edits.input.parse(edit),core.value),detail),
      };
      return pane.draw({ value, page: mounted.page, cells, selection:{read:()=>page.selected,set:(selected:any)=>move({selected})},
        write:(id:string)=>({plan:()=>run(id),apply:()=>run(id,true),cancel:()=>mounted.cancel(id),read:()=>mounted.review(id)}) } as any);
    },
    release() { released = true; argsKey=""; for (const r of reads.values()) r.stop(); },
    dispose() { if (disposed) return; disposed=true; stopSubject(); stopAddress(); for(const r of reads.values()) r.stop(); for(const o of owners.values()) o.stop(); gate.close(); listeners.clear(); },
  };
  const stopSubject=observeSubject(spec.key,{current:()=>!disposed&&!released&&input.custody.current(),read:subjectState,subscribe:mounted.subscribe});
  return mounted;
}
export type TypedMount = ReturnType<typeof mountTypedRoute>;
async function settleNative(submission: ReturnType<WorkJournalDoor["submit"]>) {
  return new Promise<unknown>((resolve,reject)=>submission.accepted.subscribe(outcome=>{
    if(outcome.kind==="pending") return;
    if(outcome.kind==="accepted-native"&&outcome.outcome==="committed") resolve(outcome.result);
    else reject(Error(outcome.kind==="rejected"?outcome.problem:"Outcome unknown; inspect History"));
  },()=>reject(Error("Command detached; inspect History before retrying"))));
}
