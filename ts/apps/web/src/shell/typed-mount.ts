import { homeHandle } from "../route/slots/sheet/index.ts";
import { peReadings, type Readings } from "#/host/resource-stream";
import { kernelVerbs, type KernelVerbKey } from "../route/slots/findings/index.ts";
import { FINDINGS_OWNER, findingsWorkSchema, type Finding } from "@pe/agent-contracts/slots";
import { hostReadSource } from "./host-read-source.ts";
import { z } from "zod";
import { readableRefusal } from "../route/readable-refusal";
import { reportFault } from "../host/diagnostics";

/** Host refusals carry serialized issues; local Value decoding throws the same issues. */
function valueRefusal(error: unknown, read: string): string {
  return readableRefusal(error, `Value unavailable (${read}): the model reading does not match its contract. Refresh to try again.`);
}
import { decodeField, encodeField } from "../route/field-codec";
import { visibleReads } from "../route/typed-route";
import {
  applyPatches,
  bindWork,
  cellPatches,
  commands,
  hostActions,
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
} from "@pe/agent-contracts";
import { ANY_ROUTE, writeSettingTier } from "@pe/agent-contracts";
import { createRouteScopeGate } from "@pe/runtime/route-scope-gate";
import { applicationWorkRegistry, createApplicationWorkRegistry } from "./application-work-registry";
import { createWorkFeedClient, createTimelineClient, type TimelineClient } from "./work-feed-client";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { publicationPose, recordedWorkDoor } from "./history";
import { settleWork } from "./work-door-observation";
import { freezePage } from "./freeze-page";
import type { PlaceInput } from "./typed-place";
import type { ReadingContext, UseSource } from "./source-contract";
import type { AnyVerb, DrawContext, EditFailure, EditHistory, PlannedVerb, RunVerb, TypedRoute, VerbContext, VerbHandle } from "../route/typed-route";
import { handle } from "@pe/agent-contracts/handle";
import type { Command } from "../../../../packages/agent-contracts/src/command.ts";
import { reasonOf, refusalOf, valueOf } from "../route/typed-route";
import type { ReadingState } from "@pe/agent-contracts";
import { absentLine, failureLine, retainedLine } from "./reading-line";
import { cancelAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { observeSubject, subjectScopeKey, type SubjectState } from "./subject";



export type RouteReadiness =
  | { kind: "ready" }
  | { kind: "pending" | "blocked"; reason: string };

type Publication = DrawContext<any, any, any, any>["value"]["publication"];
/** A read as the mount holds it: its state, the publication it came from, and the hash of a ready value. */
type Snapshot = ReadingState<any> & { readonly publication: Publication; readonly hash?: string };
// The one-to-one mapping from a read's outcome (routes CONTRACTS.md, "Reading state"): a refusal over a
// held value is `stale`, alone it is `refused`; a read in flight over a held value is `refreshing`, alone `reading`.
const unavailable = (reason: string, value?: unknown, publication: Publication = null): Snapshot =>
  value === undefined ? { state: "refused", reason, publication } : { state: "stale", value, reason, publication };
const reading = (value?: unknown, publication: Publication = null): Snapshot =>
  value === undefined ? { state: "reading", publication } : { state: "refreshing", value, publication };
const inFlight = (snapshot: Snapshot) => snapshot.state === "reading" || snapshot.state === "refreshing";

/** Typed routes execute declarations directly. No graph admission, body slots or reading scheduler. */
export function mountTypedRoute(module: TypedRoute, input: PlaceInput, fingerprint: RouteFingerprint,
  ports: { work?: WorkJournalDoor; sources?: Record<string, UseSource>; findings?: Parameters<typeof createTimelineClient>[0]; timeline?: TimelineClient; readings?: Pick<Readings, "subscribe"> } = {}) {
  const cleanups: (() => void)[] = [];
  try {
  const spec = module.spec;
  const edits = spec.edits;
  const own = edits?.work.route ?? spec.key;
  const ownerConfigs = edits?.owners ?? {};
  const ownerStops: (()=>void)[] = [];
  cleanups.push(()=>ownerStops.splice(0).reverse().forEach(stop=>stop()));
  const registry = input.fixture === null && !input.history ? applicationWorkRegistry : createApplicationWorkRegistry();
  const listeners = new Set<() => void>();
  let revision = 0, disposed = false, released = false;
  const publish = () => { revision++; listeners.forEach(f => f()); };
  const notify = () => { if (!disposed) publish(); };
  const requireCurrent = () => {
    if (disposed || !input.custody.current()) throw Error("Place is not writable");
  };
  const requireWritable = () => {
    requireCurrent();
    if (input.target === null) throw Error("Place has no write target");
    if (input.readOnly || input.history) throw Error("needs live Revit");
  };
  const decodePage = (remembered = true) => {
    const search = input.address.read();
    const memory = remembered ? z.record(z.string(),z.unknown()).parse(input.memory() ?? {}) : {};
    return freezePage({ ...Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => {
      const raw = search.get(key);
      return [key, decodeField(field, raw === null ? memory[key] ?? field.initial : raw)];
    })), selected: decodeField({ schema: focusSelectionSchema, initial: [] }, search.has("selected") ? search.get("selected") : memory.selected ?? []) });
  };
  const owners = new Map<string, {
    scope: WorkScope; config: import("../route/typed-route").Owners[string]; handle: WorkHandle | null;
    doc: any; ready: boolean; absent:boolean; problem: string | null; failure: WorkFeedFailure | null; failed: boolean;
    lease: ReturnType<typeof registry.acquire>;
  }>();
  let page: Record<string, any> = decodePage();
  const selectedKey = () => {
    if(!edits) return null;
    if(edits.key) {const member=edits.key(page as never);return member === null ? null : bindWork(own,null,member);}
    return bindWork(own,input.work.address,undefined,input.work.open ?? undefined);
  };
  let key = selectedKey();
  let timelineState: import("@pe/agent-contracts").WorkTimeline | null = null;
  let timelineProblem: string | null = "Reading Timeline";
  const problems = new Map<string,string>();
  const stepProblemBasis = new Map<string,string>();
  const timelineBasis = (value: typeof timelineState) => canonicalRouteInput(value && [
    [value.undo, value.redo].map(step => step && ("work" in step
      ? { work: step.work, revision: step.revision } : { home: step.home, sha256: step.sha256 })),
    value.rows.flatMap(row => "revision" in row ? [{ work: row.work, revision: row.revision }] : []),
  ]);
  let stopTimeline = () => {};
  const reads = new Map<import("../route/host-read").HostRead, { snapshot: Snapshot; args: string; stop(): void }>();
  const readInput = (read: import("../route/host-read").HostRead) => {
    const project = "args" in read && typeof read.args === "function" ? read.args : spec.core?.args ?? (() => ({}));
    return read.input.parse(project(page as never));
  };
  const currentPublication = (read: import("../route/host-read").HostRead) => {
    const record = reads.get(read);
    return record?.snapshot.state === "ready" && record.args === canonicalRouteInput(readInput(read))
      ? record.snapshot.publication : null;
  };
  const timelineClient = ports.timeline ?? (input.fixture === null && !input.history ? createTimelineClient(ports.findings) : null);
  const timelineWorks = () => {
    const members = new Map<string, import("@pe/agent-contracts").WorkKey>();
    // The owner feed has already resolved its binding; a duplicate read must not replace it.
    for (const key of [
      ...[...owners.values()].map(owner => owner.handle?.key ?? owner.scope.key),
      ...[...reads.keys()].flatMap(read => currentPublication(read)?.works ?? []),
    ]) if (!members.has(workKey(key))) members.set(workKey(key), key);
    return [...members.values()];
  };
  // The document head has no writable owner. Its host scope is independent of route read membership.
  const timelineDocument = () => {
    if (edits || input.target?.kind !== "document") return undefined;
    const bound = bindWork(spec.key, input.work.address, undefined, input.work.open ?? input.target.ref);
    return bound.binding === "address" || bound.binding === "open" ? bound : undefined;
  };
  let timelineMembership: string | undefined;
  const connectTimeline = (force = false) => {
    const works = timelineWorks(), document = timelineDocument();
    const core = spec.core ? reads.get(spec.core)?.snapshot : undefined;
    // Owner keys stand independently of the core. Retained members can hold a read-dependent
    // Timeline, but cannot grant membership when current owners or publications do not establish it.
    const needsValue = !works.length || core?.publication?.works.some(held => !works.some(key => workKey(key) === workKey(held)));
    const valueProblem = !document && needsValue && !!spec.core && !currentPublication(spec.core)
      ? core && (core.state === "refused" || core.state === "stale")
        ? `Undo and Redo unavailable: current Value refused. ${reasonOf(core)}. ${retainedLine(core) ?? "Refresh needed"}.`
        : "Reading Timeline: waiting for the current Value"
      : null;
    const membership = canonicalRouteInput([works, document ?? null, valueProblem]);
    if (!force && timelineMembership === membership) return;
    timelineMembership = membership;
    stopTimeline(); timelineState = null;
    timelineProblem = input.history ? "Recorded Timeline is read-only" : valueProblem ?? "Timeline unavailable";
    if (valueProblem) return;
    if (!timelineClient || !works.length && !document) return;
    let closed = false;
    const stop = timelineClient.open(works, (value, reason) => {
      if (closed || disposed) return;
      if (value) for (const direction of ["undo", "redo"]) {
        const id = `work.${direction}`, basis = stepProblemBasis.get(id);
        if (basis !== undefined && basis !== timelineBasis(value)) { problems.delete(id); stepProblemBasis.delete(id); }
      }
      timelineState = value ? freezePage(value) : null; timelineProblem = reason ?? null; notify();
    }, document);
    stopTimeline = () => { closed = true; stop(); };
  };
  cleanups.push(() => stopTimeline());
  const stepTimeline = async (direction: "undo" | "redo") => {
    const id = `work.${direction}`;
    const basis = timelineBasis(timelineState);
    problems.delete(id); stepProblemBasis.delete(id); notify();
    const refused = (message: string) => {
      if (!disposed && input.custody.current() && (!timelineState || basis === timelineBasis(timelineState))) {
        problems.set(id, message); stepProblemBasis.set(id, basis); notify();
      }
      return { message };
    };
    try {
      requireWritable();
      const expected = timelineState?.[direction];
      if (!timelineClient || !expected || timelineProblem || timelineState?.refusal[direction])
        return refused(timelineProblem ?? timelineState?.refusal[direction] ?? `Nothing to ${direction}`);
      const document = timelineDocument();
      const result = await timelineClient.step({ direction, works: timelineWorks(), expected, ...(document ? { document } : {}) });
      if (!disposed && input.custody.current()) {
        if (result) connectTimeline(true);
        watchFindings();
      }
      return result ? refused(result.message) : null;
    } catch (error) { return refused(error instanceof Error ? error.message : String(error)); }
  };
  let renderedBasis: InvocationToken | null = null;
  const dependencies = () => Object.fromEntries([...reads].filter(([read,r])=>read === spec.core && r.snapshot.state === "ready").map(([read,r])=>[read.key,r.snapshot.hash??""]));
  const workSchema:z.ZodObject=edits?.work.schema ?? z.strictObject({});
  const gate = createRouteScopeGate({
    workSchema, hashWork: canonicalRouteInput,
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
    record.absent=false; record.handle = freezePage(handle); record.doc = freezePage(parsed); record.ready = true; record.problem = null; record.failure = null; record.failed = false;
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
    if(!key) { connectTimeline(); return; }
  for (const [id, config] of Object.entries(ownerConfigs)) {
    const scope: WorkScope = { route: spec.key, fingerprint, key: { ...key, route: id },
      target: input.target, subject: null };
    const lease = registry.acquire(scope.key);
    const record = { scope, config, handle: null as WorkHandle | null, doc: null as any,
      ready: false, absent:false, problem: null as string | null, failure: null as WorkFeedFailure | null, failed: false, lease };
    owners.set(id, record);
    ownerStops.push(() => lease.release());
    const stopJournal = lease.entry.subscribe(notify);
    ownerStops.push(stopJournal);
    const stopFeed = door.open(scope).subscribe(state => {
      if (disposed || owners.get(id) !== record) return;
      try {
        if (state.kind === "ready") {
          accept(record, state.snapshot.handle, state.snapshot.value);
          for (const ack of state.history.acks)
            if (workKey(ack.key) === workKey(scope.key)) lease.entry.accept(ack.press);
        } else if (state.kind === "ack" && record.handle) {
          const ack = state.ack;
          if (ack.revision > record.handle.revision) {
            const result = applyPatches(config.state, { version: 1, revision: record.handle.revision, doc: record.doc },
              ack.by, ack.patches, ack.base, true, true);
            if (!result.ok) throw Error("error" in result ? result.error : "Work acknowledgement was refused");
            accept(record, { key: ack.key, revision: ack.revision }, result.envelope.doc);
          }
          lease.entry.accept(ack.press);
        } else if (state.kind !== "ack") {
          record.ready = false;
          record.absent=state.kind === "absent";
          if(record.absent){record.doc=null;record.handle=null;}
          record.failure=state.kind === "failed"?state.failure:null;
          record.problem = record.failure ? workFeedFailureMessage(record.failure) : record.absent ? "Start this Work to edit" : "Reading Work...";
          record.failed = record.failure !== null;
        }
      } catch (error) { record.ready = false; record.problem = String(error); record.failed = true; }
      notify();
    }, notify);
    ownerStops.push(stopFeed);
  }
  connectTimeline();
  };
  syncWork();
  const allReads = { [Symbol.iterator]() {
    const active = visibleReads(spec, page);
    for (const [read, record] of reads) if (!active.has(read)) { record.stop(); reads.delete(read); }
    return active[Symbol.iterator]();
  } };
  const syncReads = (force = false) => {
    if (disposed || released || !input.custody.current()) return;
    for (const read of allReads) {
      const args = readInput(read), signature = canonicalRouteInput(args);
      if (!force && signature === reads.get(read)?.args) continue;
      const previous = reads.get(read)?.snapshot;
      const retained: Publication=previous?.publication?freezePage({...previous.publication,freshness:"refresh-needed" as const}):null;
      reads.get(read)?.stop();
      const controller = new AbortController();
      const record: {snapshot:Snapshot;args:string;stop():void} = { args: signature, snapshot: reading(valueOf(previous),retained), stop: () => controller.abort() };
      reads.set(read, record);
      const deliver = (frame: Parameters<UseSource["open"]>[1] extends (arg: infer P) => any ? P : never) => {
        if (controller.signal.aborted || disposed || reads.get(read) !== record) return;
        if (frame.kind === "complete" || frame.kind === "part") {
          try {
            const packet = read.output.parse(frame.value);
            const publication = freezePage(packet.value);
            const current = frame.kind === "complete" && frame.fresh !== false && packet.state === "current" &&
              !!packet.value && !packet.value.coverage.unknown.length && !packet.value.coverage.refused.length;
            record.snapshot = current ? { state: "ready", value: publication!.data, publication, hash: packet.value!.evaluation }
              : unavailable(valueRefusal(frame.reason ?? packet.reason ?? "Incomplete Value", read.key), publication?.data??valueOf(record.snapshot), publication??record.snapshot.publication);
          } catch (error) { record.snapshot = unavailable(valueRefusal(error, read.key), valueOf(record.snapshot), record.snapshot.publication); }
        } else if (frame.kind !== "log") record.snapshot = frame.kind === "failure"?unavailable(valueRefusal(frame.error, read.key),valueOf(record.snapshot),record.snapshot.publication):reading(valueOf(record.snapshot),record.snapshot.publication);
        connectTimeline(); notify();
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
        Promise.resolve(source.open(ctx, deliver)).then(stop => {
          if (controller.signal.aborted) stop?.();
          else record.stop = () => { controller.abort(); stop?.(); };
        }).catch(error => deliver({ kind: "failure", error }));
      }
    }
    connectTimeline(); notify();
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
    for (const [key,value] of Object.entries(patch)) search.set(key, encodeField(spec.fields[key], value));
    input.address.write(search, history);
    return { kind: "accepted", changed: true } as const;
  };
  const moveRole = (role:"pose"|"query", patch:Record<string,unknown>, history?:"push"|"replace") => {
    for (const key of Object.keys(patch)) if (spec.fields[key]?.role !== role && !(role === "pose" && spec.fields[key]?.role === "stage")) throw Error(`${key} is not a ${role} field`);
    return move(patch,history);
  };
  // The Page the address holds; an address without `selected` keeps the current selection.
  const addressPage = (remembered = true) => { const next = decodePage(remembered); return input.address.read().has("selected") ? next : { ...next, selected: page.selected }; };
  const stopAddress = input.address.subscribe(() => {
    const next = addressPage();
    // An unchanged address can be the custody-return notification for released read resources.
    if (canonicalRouteInput(next) === canonicalRouteInput(page)) { syncReads(); return; }
    page = freezePage(next);
    gate.movePage(page, { kind: "human", source: "query", history: "replace" }); syncWork(); syncReads(); notify();
  });
  cleanups.push(stopAddress);
  const valueAfterWork = () => [...owners.values()].some(owner => owner.ready && owner.config.value && spec.core &&
    canonicalRouteInput(owner.doc) !== canonicalRouteInput(valueOf(reads.get(spec.core)?.snapshot)?.[owner.config.value!]))
    ? "Refreshing Value after Work changed" : null;
  const basisRefusal = () => {
    if (input.readOnly || input.history) return "needs live Revit";
    if(!edits) return "No Work declared";
    if(!key) return "Choose a Work member";
    const owner = [...owners.values()].find(o=>!o.ready);
    if (owner) return owner.problem ?? "Reading Work...";
    const core = spec.core ? reads.get(spec.core)?.snapshot : undefined;
    if (spec.core && core?.state !== "ready") return core ? reasonOf(core) : "Reading Value...";
    return valueAfterWork();
  };
  // The binding lookup: `hostActions` holds the semantic commands and the direct reads, receipt controls,
  // `ops.read` and `page.bind` beside them.
  const declared = (key: string): Command | undefined => hostActions[key as keyof typeof hostActions];
  /** A command that carries the route's Work handle cannot run before that Work exists (a raw
   *  `work: null` decode error was the 2b drive's /pods "Open saved bytes"); it refuses with the Work's
   *  own reason ("Start this Work to edit"), as the cells do. */
  const workRefusal = (key: string) => {
    const work = declared(key)?.work;
    if (!work || work.optional || owners.get(own)?.handle) return null;
    return !edits ? "This view keeps no Work" : owners.get(own)?.problem ?? "Reading Work...";
  };
  const writeRefusal = () => input.fixture !== null ? "Fixture has no native writes" : basisRefusal();
  // Settlement includes every demanded reading, not only the core write basis.
  const readiness = (): RouteReadiness => {
    if (disposed || released || !input.custody.current()) return { kind: "blocked", reason: "Place is inactive or retired" };
    for (const owner of owners.values()) {
      if (owner.absent) continue;
      if (owner.lease.entry.pending().some(intent => intent.status === "pending"))
        return { kind: "pending", reason: "Acknowledging Work..." };
      if (!owner.ready) return { kind: owner.failure || owner.problem && owner.problem !== "Reading Work..." ? "blocked" : "pending", reason: owner.problem ?? "Reading Work..." };
    }
    for (const read of allReads) {
      const value = reads.get(read)?.snapshot ?? reading();
      if (value.state !== "ready") return { kind: inFlight(value) ? "pending" : "blocked", reason: reasonOf(value) };
    }
    // Recorded and fixture views can settle without granting native write authority.
    const reason = valueAfterWork();
    if (reason) return { kind: "pending", reason };
    return { kind: "ready" };
  };
  const whenSettled = (writable: boolean) => new Promise<void>((resolve, reject) => {
    let stop = () => {};
    const inspect = () => {
      const state = readiness();
      if (state.kind === "pending") return;
      stop();
      const reason = state.kind === "blocked" ? state.reason : writable ? writeRefusal() : null;
      if (reason) reject(Error(reason));
      else resolve();
    };
    // Waiting observes custody; it must not reacquire a released Place.
    listeners.add(inspect);
    stop = () => { listeners.delete(inspect); };
    inspect();
  });
  const basis = () => {
    if (basisRefusal()) return null;
    if(renderedBasis && gate.current(renderedBasis)) return renderedBasis;
    const issued = gate.invocation(gate.capture("draw"), dependencies());
    return renderedBasis = issued.ok ? issued.value : null;
  };
  const submit = async (record: typeof owners extends Map<string, infer R> ? R : never, request: WorkWrite, token: InvocationToken) => {
    requireWritable();
    const result = await settleWork(door.submitWork(record.scope, request, token));
    if (result.kind !== "accepted") throw Error(result.kind === "refused" ? result.refusal.error : "Work write did not settle");
    const ack = result.ack;
    if (record.handle && ack.revision > record.handle.revision) {
      const applied = applyPatches(record.config.state, { version: 1, revision: record.handle.revision, doc: record.doc }, ack.by, ack.patches, ack.base, true, true);
      if (applied.ok) accept(record, { key: ack.key, revision: ack.revision }, applied.envelope.doc);
    }
    record.lease.entry.accept(ack.press); notify();
    return { ok: true, revision: ack.revision, handle: { key: ack.key, revision: ack.revision }, write: ack } as const;
  };
  const reviews = new Map<string, { preview: z.output<typeof writePreviewSchema>; input: Record<string, unknown>; token: InvocationToken; signature: string; presentation: any }>();
  const applyingReviews = new Map<string, ReturnType<typeof reviews.get>>();
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
      if (core?.state !== "ready") return refused(core ? reasonOf(core) : "Reading the subject roster");
      const options=subjectSpec.options(core.value), ids=subject.kind==="all"?options.map(o=>o.id):subject.ids??[];
      if (ids.some(id=>!options.some(o=>o.id===id))) return refused(`A ${spec.subject?.noun ?? "Subject"} in this link is not in this model; choose it again from the roster`);
      if (canonicalRouteInput(subject)!==canonicalRouteInput(page[field])) return null;
      const link = input.address.read();
      link.delete("thread"); link.delete("shell");
      if (!link.has(field)) link.set(field,JSON.stringify(page[field]));
      return {ready:true,refusal:null,label:ids.length===1?options.find(o=>o.id===ids[0])!.label:ids.length?`${ids.length} ${spec.subject?.noun ?? "Subject"}s`:"",link:`${module.data.address}?${link}`};
    } catch { return refused(`${spec.subject?.noun ?? "Subject"} is malformed`); }
  };
  // The document's findings Work (ADR 0035 rule 9), for the kernel's drawing: the host's `work` Reading of the
  // findings key, subscribed on first ask and again when the key changes. Pea's write and a person's arrive the
  // same way, with no reload. The key is the one the findings history door uses: the route's own document-bound
  // Work key, as the host resolved it; a route whose Work is keyed by a member, or that keeps none, binds the
  // document itself.
  let findings: readonly Finding[] = [], findingsAt: string | null = null, stopFindings = () => {};
  cleanups.push(() => stopFindings());
  const findingsKey = () => (!edits?.key && owners.get(own)?.handle?.key)
    || (input.work.address || input.work.open ? bindWork(FINDINGS_OWNER, input.work.address, undefined, input.work.open ?? undefined) : null);
  const watchFindings = () => {
    const key = findingsKey(), at = key ? workKey(key) : "";
    if (findingsAt === at) return;
    findingsAt = at; findings = []; stopFindings(); stopFindings = () => {};
    if (input.fixture !== null || input.history || !key) return;
    const fault = (error: unknown) => reportFault({ code: "reading.failed", routeCode: spec.key, readingKind: FINDINGS_OWNER }, error);
    // A frame can arrive inside `subscribe`, while a pane is drawing: that value is returned, never notified.
    let subscribing = true;
    stopFindings = (ports.readings ?? peReadings).subscribe({ ...key, route: FINDINGS_OWNER, kind: "work" }, (frame) => {
      if (disposed) return;
      if (frame.kind === "failure") return fault(Error(frame.error));
      if (frame.kind !== "snapshot") return;
      // No findings Work yet reads as null: none said. One that does not decode keeps what is drawn and is a fault.
      const parsed = z.object({ doc: findingsWorkSchema }).nullable().safeParse(frame.value);
      if (!parsed.success) return fault(parsed.error);
      findings = parsed.data ? Object.values(parsed.data.doc.findings) : [];
      if (!subscribing) notify();
    });
    subscribing = false;
  };
  const pending = new Set<string>();
  type Verb = AnyVerb;
  const verbContext = (work: WorkHandle | null): VerbContext => ({ page, target: input.target, work,
    value: spec.core ? valueOf(reads.get(spec.core)?.snapshot) : undefined, doc: owners.get(own)?.doc ?? undefined });
  /** A verb whose handle has no plan: one send through the one door, which picks the transport from the handle. */
  const send = async (id: string, verb: Verb, supplied?: unknown) => {
    requireWritable();
    if (input.fixture !== null) throw Error("Fixture has no native writes");
    problems.delete(id); notify();
    const key = verb.handle.key;
    // A read answers the Page it was asked from; a write lands whatever the Page did meanwhile.
    const readPage = verb.handle.effect === "Read" ? gate.read()?.pageEpoch : null;
    try {
      const refusal = workRefusal(key);
      if (refusal) throw Error(refusal);
      const work = owners.get(own)?.handle ?? null;
      const proposed = z.record(z.string(), z.unknown()).parse(verb.input?.(verbContext(work), supplied) ?? supplied ?? {});
      // The host decodes the input (K2): a malformed one returns as its typed refusal.
      const request = declared(key)?.work && work ? { ...proposed, work } : proposed;
      // A journaled command resolves its own target; a route keeps the Place's (`ops.read` runs on a host, a session or a document).
      const target = verb.handle.via === "command"
        ? commandTarget(key, request, input.target?.kind === "document" ? input.target.ref : undefined)
        : input.target ?? { kind: "host" as const };
      const receipt = z.object({ receiptId: z.string().optional(), result: z.unknown().optional() })
        .parse(await settleNative(door.submit({ id: crypto.randomUUID(), key, target, input: request }), true));
      const answered = declared(key);
      const result = verb.handle.via !== "command" || (answered && "result" in answered) ? receipt.result : { kind: "void", receiptId: receipt.receiptId };
      if (readPage && (disposed || !input.custody.current() || gate.read()?.pageEpoch !== readPage))
        throw Error("This read finished for an earlier Page; run it again");
      syncReads(true);
      return result;
    } catch (error) {
      // A refusal that is a validator's issue list reads as one sentence, as a Value does (`valueRefusal`);
      // the list (a whole regex, for a format) is diagnostics' and never the person's.
      const raw = error instanceof Error ? error.message : String(error);
      // The door carries a refusal as its sentence, so a validator's issue list arrives as that text.
      let issues: unknown = error instanceof z.ZodError ? error.issues : null;
      if (!issues) try { issues = JSON.parse(raw); } catch { /* A domain sentence. */ }
      const at = z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) })).safeParse(issues).data?.[0]?.path.join(".");
      const said = readableRefusal(error, `${verb.label} does not match its contract${at ? ` at ${at}` : ""}. The detail is in the log.`);
      problems.set(id, said);
      if (said === raw) throw error;
      reportFault({ code: "action.failed", routeCode: spec.key, readingKind: key }, error);
      throw Error(said, { cause: error });
    }
    finally { notify(); }
  };
  /** A verb whose handle has a plan: plan, seal, and apply only the sealed review. */
  const review = async (id: string, verb: Verb, apply: boolean, supplied?: unknown) => {
    requireWritable();
    if (input.fixture !== null) throw Error("Fixture has no native writes");
    problems.delete(id); notify();
    const key = verb.handle.key;
    if (apply) {
      const held = reviews.get(id);
      if (!held || !reviewCurrent(id, held.token, held.signature)) throw Error("Review is stale; prepare it again");
      applyingReviews.set(id,held); reviews.delete(id); notify();
      try {
        const result = await settleNative(door.submit({ id: crypto.randomUUID(), key, target: input.target!, input: held.input }));
        syncReads(true); return result;
      } finally {applyingReviews.delete(id);notify();}
    }
    let token: InvocationToken | undefined;
    try {
      if (!basis() || [...owners.values()].some(o => !o.ready)) throw Error(basisRefusal() ?? "Work unavailable");
      const core = spec.core ? reads.get(spec.core)?.snapshot : undefined;
      if (core?.state !== "ready") throw Error(core ? reasonOf(core) : "Read the current Value before planning");
      const issued=gate.invocation(gate.capture(`plan:${id}`),dependencies());
      if(!issued.ok) throw Error(issued.reason);
      token=issued.value; plans.set(id,token); reviews.delete(id);
      const binding = declared(key)?.work;
      // A door every route shares (the sheet pair, ANY_ROUTE) takes the asking route's own Work.
      const primary = owners.get(binding && binding.route !== ANY_ROUTE ? binding.route : own)!.handle!;
      const proposed=verb.input?.(verbContext(primary),supplied) ?? supplied ?? {};
      const request = { ...z.record(z.string(),z.unknown()).parse(proposed), work: primary,
        readWorks: Object.fromEntries([...owners].filter(([id]) => id !== primary.key.route).map(([id,o]) => [id,o.handle])) };
      const signature = workSignature();
      const context = verbContext(primary);
      const result = await settleNative(door.submit({ id: token.id, key: verb.handle.plan!.key, target: input.target!, input: request }));
      const preview = writePreviewSchema.parse(result);
      const sealed = z.object({ handle: workHandleSchema }).parse(preview.seal.work).handle;
      if (canonicalRouteInput(sealed) !== canonicalRouteInput(primary)) throw Error("Preview sealed a different Work");
      if (!reviewCurrent(id, token, signature)) throw staleReview(token, signature);
      const presented=presentationSchema.parse(verb.present!(preview,context));
      reviews.set(id, { preview, input: request, token, signature,
        presentation: typeof presented === "string" ? {sentence:presented,rows:[]} : presented });
      problems.delete(id);
    } catch (error) { if(!token || plans.get(id)===token) problems.set(id,error instanceof Error?error.message:String(error)); throw error; }
    finally { notify(); }
  };
  /** One press at a time per verb; a failure is kept for the handle to draw. */
  const press = async (id: string, act: () => Promise<unknown>) => {
    if(pending.has(id)) throw Error("Action already pending");
    pending.add(id); notify();
    try { return await act(); }
    catch(error) { if (!problems.has(id)) problems.set(id,error instanceof Error?error.message:String(error)); throw error; }
    finally {pending.delete(id);notify();}
  };
  const verbRefusal = (verb: Verb) => input.readOnly || input.history ? "needs live Revit" : input.fixture !== null ? "Fixture has no native actions"
    : verb.handle.plan ? basisRefusal() : workRefusal(verb.handle.key);
  const handleOf = (id: string, verb: Verb): VerbHandle => {
    const facts = { label: verb.label, effect: verb.handle.effect, get pending(){return pending.has(id);},
      get refusal(){return verbRefusal(verb);}, get failure(){return problems.get(id)??null;} };
    return verb.handle.plan
      ? Object.defineProperties({ plan:(supplied?:unknown)=>press(id,()=>review(id,verb,false,supplied)), apply:()=>press(id,()=>review(id,verb,true)),
          cancel:()=>mounted.cancel(id), read:()=>mounted.review(id) }, Object.getOwnPropertyDescriptors(facts)) as PlannedVerb
      : Object.defineProperties({ run:(supplied?:unknown)=>press(id,()=>send(id,verb,supplied)) }, Object.getOwnPropertyDescriptors(facts)) as RunVerb;
  };
  syncReads();
  const mounted = {
    spec, data: module.data, subjectState, move, readiness,
    whenReady: () => whenSettled(false),
    whenWritable: () => whenSettled(true),
    absentOwners:()=>[...owners].filter(([id,owner])=>id!==own&&owner.absent).map(([route])=>route),
    startAction(): RunVerb | null {
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
      return {label:"Start",effect:handle("work.start").effect,get pending(){return pending.has("work.start");},get refusal(){return refusal();},
        get failure(){return problems.get("work.start")??null;},run};
    },
    /** Who draws each verb (routes CONTRACTS.md, "Placement on a mount"): the band's ids, the first primary, and each pane's. */
    placement: () => ({ band: spec.band, panes: Object.fromEntries(Object.entries(spec.panes).map(([id, pane]) => [id, pane.verbs ?? []])) as Readonly<Record<string, readonly string[]>> }),
    verb(id: string): VerbHandle {
      const verb = spec.verbs[id];
      if(!verb) throw Error(`Unknown verb ${id}`);
      return handleOf(id, verb);
    },
    /** A kernel verb: on every route, declared by none, never placed. This only reads the kernel's table. */
    kernelVerb(key: KernelVerbKey): RunVerb {
      const verb = kernelVerbs[key];
      if(!verb) throw Error(`Unknown kernel verb ${key}`);
      return handleOf(`kernel:${key}`, verb) as RunVerb;
    },
    findings: () => { watchFindings(); return findings; },
    stopCommand: (id:string) => {requireWritable();return cancelAction(id);},
    attention: {
      write: (page:object) => Object.fromEntries(Object.keys(spec.fields).map(key=>[key,JSON.stringify((page as Record<string,unknown>)[key])])),
      read: (patch: Record<string, string>) => Object.fromEntries(Object.entries(patch).map(([key, text]) => {
        const field = spec.fields[key];
        if (!field) throw Error(`${key} is not an attention field`);
        const subject = spec.subject;
        let value: unknown;
        try { value = JSON.parse(text); } catch (cause) {
          if (subject?.field !== key) throw cause;
          value = text;
        }
        if (subject?.field === key && !field.schema.safeParse(value).success) {
          const roster = reads.get(subject.read ?? spec.core!)?.snapshot;
          if (roster?.state !== "ready") throw Error("Read the subject roster before choosing a name");
          const options = subject.options(roster.value);
          const resolve = (name: unknown) => {
            if (typeof name !== "string") throw Error("A subject name must be text");
            const exact = options.filter(option => option.id === name || option.label === name);
            const matches = exact.length ? exact : options.filter(option => option.label.toLowerCase() === name.toLowerCase());
            if (matches.length !== 1) throw Error(`${matches.length ? "Ambiguous" : "Unknown"} ${subject.noun}: ${name}; choose an exact roster identity`);
            return matches[0]!.id;
          };
          value = value === "all" && !options.some(option => option.label === "all")
            ? { kind: "all" }
            : { kind: "ids", ids: (Array.isArray(value) ? value : [value]).map(resolve) };
        }
        return [key, field.schema.parse(value)];
      })),
    }, current: (token:InvocationToken) => gate.current(token),
    // ponytail: a read the route never declared has not run; no caller draws this state (a pane with no read always draws).
    value: (read: import("../route/host-read").HostRead | undefined = spec.core): Snapshot => read ? reads.get(read)?.snapshot ?? reading() : { state: "not-yet-run", publication: null },
    owner: (id = own) => owners.get(id),
    page: { read: () => page, pose: (patch: any, intent?: "gesture"|"named") => moveRole("pose",patch,intent === "gesture"?"replace":intent === "named"?"push":undefined), query: (patch: any) => moveRole("query",patch), select: (selected: any) => move({selected}), subject: (subject: any) => {if(!spec.subject) throw Error("No subject declared");return move({ [spec.subject.field]: subject },"push");} },
    subscribe(listener: () => void) { const resume = released; released = false; listeners.add(listener); if (resume) connectTimeline(true); syncReads(); return () => { listeners.delete(listener); }; },
    available: () => !disposed && input.custody.current(),
    /** The URL write is flushed: the address alone, without Place memory, decodes to this Page
     *  (slice 6.1, `data-url-settled`); a reload reads only the address. */
    urlCurrent: () => canonicalRouteInput(addressPage(false)) === canonicalRouteInput(page), target: () => input.target, revision: () => revision, work: () => gate.read()?.work ?? null, workBasis: basis,
    problem: () => edits?basisRefusal():null, writeRefusal,
    /** The basis that failed (a Work feed failure, a thrown read), as distinct
     *  from a state such as "Start this Work to edit": failures draw as a pane failure line. */
    failure: () => {
      if (!edits) return null;
      const owner = [...owners.values()].find(o => !o.ready && o.failed);
      return owner ? owner.problem : null;
    },
    // A named read refreshes with the rest: every read is demanded at mount.
    refresh: (_read?:import("../route/host-read").HostRead) => {
      requireCurrent(); syncReads(true);
    },
    review: (id: string) => { const r=reviews.get(id)??applyingReviews.get(id); if(!r) return null;
      const stale = !reviewCurrent(id, r.token, r.signature);
      return { preview: stale || !reviews.has(id) ? undefined : r.preview, sentence: stale ? null : r.presentation.sentence,
        rows: stale ? [] : r.presentation.rows, cells: stale ? [] : r.presentation.cells, stale }; },
    reviewProblem: (id: string) => problems.get(id) ?? null,
    cancel: (id: string) => { const token=plans.get(id);if(token) gate.retire(token.token);plans.delete(id);reviews.delete(id);notify(); },
    timeline: () => disposed ? null : timelineState,
    stepTimeline,
    timelineRefusal: () => input.readOnly ? "needs live Revit" : timelineProblem,
    pendingEdits: () => [...owners.values()].flatMap(o => o.lease.entry.pending()),
    discardIntent(id: string) { for (const owner of owners.values()) owner.lease.entry.discard(id); notify(); },
    // A caller that draws one known pane may name that pane's context type; the mount does not check it.
    draw<C = DrawContext<any,any,any,any>>(id: string, render?: (ctx: C)=>unknown) {
      const pane = spec.panes[id]!;
      // A pane that names a read draws only over a present value: the shell's one line stands in for
      // reading, refused and not-yet-run, so a body never meets a missing value. A pane with no read always draws.
      const value = pane.read ? mounted.value(pane.read) : undefined;
      // A failed basis outranks the wait it causes: the core pane says what failed, not that it is reading.
      const failed = pane.read === spec.core ? mounted.failure() : null;
      if (value && !("value" in value)) return failed ? failureLine(failed) : absentLine(value);
      const core = mounted.value();
      const token = basis();
      const drawnOwners = new Map(owners);
      const handles = new Map([...owners].map(([id,o]) => [id,o.handle]));
      const docs = new Map([...owners].map(([id,o]) => [id,o.doc]));
      const ready = !!token && (!value || value.state === "ready");
      const why = basisRefusal() ?? (value && refusalOf(value)) ?? "Read the current Value before editing";
      const refusal = ready ? null : why;
      const doc = owners.get(own)?.doc ?? null;
      // Work readiness is the same union: absent Work has not run (Start runs it); a held doc that cannot be edited is refreshing or stale.
      const state: ReadingState<unknown> = ready ? { state: "ready", value: doc } : owners.get(own)?.absent ? { state: "not-yet-run" }
        : readiness().kind === "pending" ? (doc === null ? { state: "reading" } : { state: "refreshing", value: doc, reason: why })
        : doc === null ? { state: "refused", reason: why } : { state: "stale", value: doc, reason: why };
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
            const admission=record.lease.entry, intent=admission.retain(write,label);
            notify();
            try {
              requireWritable();
              if (!basis() || !gate.current(token)) throw Error("Stale accepted Work basis");
              if (owners.get(id)!==record || !record.ready || canonicalRouteInput(record.handle)!==canonicalRouteInput(handle)) throw Error("Owning Work changed since this cell was drawn");
              await submit(record,write,token);
              admission.discard(intent);
            } catch(error) {
              admission.refuse(intent,error instanceof Error?error.message:String(error));
              throw error;
            } finally { notify(); }
          }));
          return null;
        } catch(error) { return {code:"refused",message:error instanceof Error?error.message:String(error)}; }
      };
      const cells: DrawContext<any, any, any, any>["cells"] = {
        doc, basis: token, state,
        owner(path) { const route=ownerOf(path); return {route,label:route===own?"Work":`from /${route}`}; },
        at(path,preferred,facts={}) {
          if (path[0] === "setting") return homeHandle(path, valueOf(core), async request => {
            requireWritable();
            try {
              if (core.state !== "ready") throw Error(reasonOf(core));
              await settleNative(door.submit({ id: crypto.randomUUID(), key: writeSettingTier.key,
                target: input.target?.kind === "document" ? input.target : { kind: "host" }, input: request }));
            } finally { mounted.refresh(); }
          });
          const route=ownerOf(path,preferred), address=[...path];
          const value=address.reduce((doc,key)=>doc?.[key],owners.get(route)!.doc)??{};
          const cellPatch=(patches: readonly RouteStatePatch[],detail?:EditHistory) => facts.readOnly
            ? Promise.resolve({code:"read-only",message:"This cell is read-only"}) : patch(patches,detail,route);
          const clear=(detail?:EditHistory)=>cellPatch(cellPatches(address.slice(0,-1),address.at(-1)!,value,{kind:"clear"}),detail);
          const accepted = value.edit;
          const accept=(detail?:EditHistory) => {
            if(!accepted) return Promise.resolve({code:"not-staged",message:"This cell is no longer staged"});
            const {by:_by,at:_at,base:_base,...rung}=accepted;
            return cellPatch([{path:[...address,"edit"],value:rung}],detail);
          };
          return {owner:{route,label:route===own?"Work":`from /${route}`},value, facts:{...facts,baseline:facts.baseline??value.base?.value},
            freshness:ready?"current":owners.get(route)!.doc===null&&valueOf(core)===undefined?"never":"stale", refusal: facts.readOnly ? "This cell is read-only" : refusal, clear, accept,deny:clear,
            delete:(detail)=>cellPatch([{path:address}],detail),
            stage:(value2,detail)=> facts.readOnly ? Promise.resolve({code:"read-only",message:"This cell is read-only"}) :
              patch(cellPatches(address.slice(0,-1),address.at(-1)!,value,
                Object.hasOwn(facts,"baseline")&&canonicalRouteInput(value2)===canonicalRouteInput(facts.baseline)?{kind:"clear"}:{kind:"set",rung:{value:value2}}),detail,route),
            transitions:(detail)=>!ready?[]:[...(value.edit?[{kind:"clear" as const,run:()=>clear(detail)},...(value.edit.by==="pea"?[{kind:"take" as const,run:()=>accept(detail)},{kind:"unsuggest" as const,run:()=>clear(detail)}]:[])]:[])]};
        },
        label(input,label) { const foreign=[...new Set(edits!.patches(input,valueOf(core)).map(p=>ownerOf(p.path.map(String))))].filter(id=>id!==own); return foreign.length?`${label} · ${foreign.map(id=>`from /${id}`).join(", ")}`:label; },
        patch,
        edit: (edit,detail)=>patch(()=>edits!.patches(edits!.input.parse(edit),valueOf(core)),detail),
      };
      return (render ?? ((ctx: DrawContext<any,any,any,any>) => pane.draw(ctx).node))({ target: input.target, refresh:mounted.refresh, read:(read:import("../route/host-read").HostRead)=>mounted.value(read), absent:absentLine, value, page: mounted.page, cells, selection:{read:()=>page.selected,set:(selected:any)=>move({selected})},
        // A route's own id wins over a kernel verb of the same name.
        verb:(id:string)=>Object.hasOwn(spec.verbs,id)||!Object.hasOwn(kernelVerbs,id)?mounted.verb(id):mounted.kernelVerb(id as KernelVerbKey) } as any);
    },
    // Retaining hidden read connections was a Plan-identity workaround; content fingerprints
    // now survive reconnect. Keep Work feeds connected so pending edits settle.
    // Read release preserves write authority; disposal and Place custody fence writes.
    release() { if (disposed || released) return; released = true; stopTimeline(); timelineState = null; timelineProblem = "Timeline is inactive"; notify(); for (const r of reads.values()) { r.args=""; r.stop(); } },
    dispose() { if (disposed) return; disposed=true; publish(); cleanups.splice(0).reverse().forEach(stop => stop()); listeners.clear(); },
  };
  const stopSubject=observeSubject(spec.key,{current:()=>!disposed&&!released&&input.custody.current(),read:subjectState,subscribe:mounted.subscribe});
  cleanups.push(stopSubject);
  return mounted;
  } catch (error) { cleanups.reverse().forEach(stop => stop()); throw error; }
}
export type TypedMount = ReturnType<typeof mountTypedRoute>;
/** For a holder of only the id (a test, a harness): the handle as the kind it must be, or a throw. */
export const planned = (verb: VerbHandle): PlannedVerb => { if (!("plan" in verb)) throw Error(`${verb.label} has no plan`); return verb; };
export const direct = (verb: VerbHandle): RunVerb => { if (!("run" in verb)) throw Error(`${verb.label} is reviewed: plan it`); return verb; };
async function settleNative(submission: ReturnType<WorkJournalDoor["submit"]>,receipt=false) {
  return new Promise<unknown>((resolve,reject)=>submission.accepted.subscribe(outcome=>{
    if(outcome.kind==="pending") return;
    if(outcome.kind==="accepted-native"&&outcome.outcome==="committed") resolve(receipt?{receiptId:outcome.receiptId,result:outcome.result}:outcome.result);
    else reject(Error(outcome.kind==="rejected"?outcome.problem:"Outcome unknown; inspect History"));
  },()=>reject(Error("Command detached; inspect History before retrying"))));
}
