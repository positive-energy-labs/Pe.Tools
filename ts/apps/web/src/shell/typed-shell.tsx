import { SheetPane } from "../route/slots/sheet/pane.tsx";
import { GoalPane } from "../route/slots/goal/pane.tsx";
import type { Goal } from "@pe/agent-contracts/slots";
import { refuse } from "../route/refusal";
import * as Atom from "effect/reactivity/Atom";
import { AttentionScope } from "../attention";
import { elementIndex } from "../element-index";
import { NativeObservationScope } from "../revit/observation";
import { ValueScope } from "@pe/kit/lang/collection";
import type { DrawContext } from "../route/typed-route";
import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { GraphLayoutView, type GraphLayoutState } from "@pe/kit";
import { Button } from "@pe/kit/lang/button";
import { PreviewAction } from "@pe/kit/lang/write-action";
import { KeyScopeHost, ScopeKeys, actionScopeKeys } from "@pe/kit/keys";
import { routeOf, routeAddress, canonicalRouteInput, type LayoutNode } from "@pe/agent-contracts";
import { useRouteTarget } from "../route/route-target";
import { parseTarget } from "../route/target-codec";
import { appAtomRegistry } from "./owner";
import { admittedRouterAddress, PlaceBoundary } from "./typed-place-boundary";
import type { AdmittedPlace, PlaceInput } from "./typed-place";
import { HistoryBoundary, RecordedPoints } from "./history-rail";
import { paneFrame } from "../route/body";
import { historyRequest, publicationPose, type HistorySnapshot } from "./history";
import { DocumentPicker } from "./document-picker";
import { RouteVisibility } from "../route/activity";
import { SituationBand, TimelineHead } from "./situation-band";
import { CatalogWorkReviews } from "./catalog-work-reviews";
import { readLayoutState, writeLayoutState } from "./layout-state";
import { GraphHistory } from "./graph-history";
import { PaneActionSlots, usePaneActionSlot } from "./pane-actions";
import { SubjectDoor } from "./subject";
import { SubjectPicker } from "./subject-picker";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { typedSubjectDoor } from "./subject";
import { PrimaryRouteControls, useHasGlobalNavigation } from "../navigation/route-controls";
import { useRouteViewBridge } from "../route/view-bridge";
import { createContext, useInsertionEffect, useLayoutEffect } from "react";
import { useRouteCurrent } from "../route/activity";
import { mountTypedRoute, type TypedMount } from "./typed-mount";
import type { TypedRoute } from "../route/typed-route";
import type { RouteFingerprint } from "@pe/agent-contracts";
import type { AdmittedAddressPort } from "./typed-address";
import { hostedRouteAddress, type HostedRouteProps } from "../workbench/hosted-route";

/** A typed route bypasses web admission. Only its host Work registration needs the closure stamp. */
export function TypedRouteView({ module, fingerprint, address: supplied }: { module: TypedRoute; fingerprint: RouteFingerprint; address?: AdmittedAddressPort }) {
  const router = useRouter();
  const address = useMemo(() => supplied ?? admittedRouterAddress(router.history), [router,supplied]);
  return <PlaceBoundary<{mount:TypedMount;dispose():void}> identity={module} path={module.data.address} address={address}>
    {place => <HistoryBoundary address={place.address}>{snapshot => <TypedPlace module={module} place={place} fingerprint={fingerprint} snapshot={snapshot} />}</HistoryBoundary>}
  </PlaceBoundary>;
}

function TypedPlace({ module, place, fingerprint, snapshot }: { snapshot?: HistorySnapshot; module: TypedRoute; place: AdmittedPlace<{ mount: TypedMount; dispose(): void }>; fingerprint: RouteFingerprint }) {
  const search = useSyncExternalStore(place.address.subscribe, () => place.address.read().toString());
  const fixture = place.fixture, visible = useContext(RouteVisibility);
  const params = new URLSearchParams(search), compare = !!snapshot && params.get("compare") === "now";
  const history = compare ? undefined : snapshot;
  const [liveInstance] = useState(() => `${module.spec.key}:${crypto.randomUUID()}`);
  const poses = snapshot?.point.history.poses.filter(p => p.route === module.spec.key && (!params.get("atInstance") || p.instance === params.get("atInstance"))) ?? [];
  const pose = poses.length === 1 ? poses[0] : undefined, instance = pose?.instance ?? liveInstance;
  const pin=compare?snapshot.point.history.address:params.get("target");
  const needs=module.spec.needs;
  const required=needs === "host" ? (pin ? module.spec.optionalTarget : undefined) : needs === "browser" ? undefined : needs;
  const seed = useMemo(() => history ? { target: { kind: "document" as const, ref: history.point.history.target } } : fixture === null && required ? undefined : {}, [history,fixture,required]);
  const target = useRouteTarget({ needs: required === "session" ? "document" : required }, appAtomRegistry, seed, pin);
  const resolved = needs === "browser" ? null : target.resolution.kind === "resolved" ? target.resolution.target : null;
  const signature = canonicalRouteInput([resolved, target.workAddress, target.workOpen, history?.point.id, !!snapshot, instance]);
  const current = useRef(signature); current.current = signature;
  const input = useMemo<PlaceInput>(() => ({ address: place.address, fixture, target: resolved, history, readOnly: !!snapshot, publicationInstance: instance,
    work: { address: history?.point.history.address ?? target.workAddress, open: resolved?.kind === "document" ? resolved.ref : target.workOpen },
    custody: { current: () => place.current() && current.current === signature }, memory: history ? () => pose?.page ?? {} : place.memory }), [place,signature]);
  const [mounted,setMount] = useState<{mount:TypedMount;input:PlaceInput} | null>(null);
  const mount = mounted?.input === input ? mounted.mount : null;
  const [problem,setProblem] = useState<string | null>(null);
  useEffect(() => {
    place.setVisible(visible);
    if (snapshot && !pose || needs !== "browser" && !input.target && !input.work.address && !input.work.open) { setMount(null); setProblem(null); return; }
    let state: { mount: TypedMount; input?: PlaceInput; dispose(): void };
    try {
      state = place.state(() => ({ mount: mountTypedRoute(module,input,fingerprint), input, dispose() { this.mount.dispose(); } }));
      if (state.input !== input) { state.mount.dispose(); state.mount=mountTypedRoute(module,input,fingerprint); state.input=input; }
      setMount({mount:state.mount,input}); setProblem(null);
    } catch(error) { setMount(null); setProblem(String(error)); return; }
    return () => state.mount.release();
  }, [module,place,input,visible]);
  const lastPose = useRef("");
  useEffect(() => {
    if (!mount) return;
    const remember = () => {
      const page = mount.page.read();
      if (!history) place.remember(page);
      if (snapshot || !target.workAddress || fixture !== null) return;
      const pose = publicationPose(instance,module.spec.key,page);
      const signature = canonicalRouteInput([target.workAddress,pose]);
      window.dispatchEvent(new Event("pe:history-change"));
      if (lastPose.current === signature) return;
      lastPose.current = signature;
      void historyRequest("",{kind:"page",document:target.workAddress,pose}).then(() => window.dispatchEvent(new Event("pe:history-change"))).catch(() => {});
    };
    remember();
    return mount.subscribe(remember);
  }, [mount,place,history,snapshot,target.workAddress,instance,fixture,module]);
  // Slice 6.1: a script awaits `[data-url-settled]` before it reads or reloads the URL. A Place
  // whose `?target` does not parse never claims it, so a re-encoded target shows here first.
  const urlSettled = useSyncExternalStore(mount?.subscribe ?? still, () => !!mount && visible && parseTarget(params.get("target"))?.kind !== "invalid" && mount.urlCurrent());
  const document = <DocumentPicker place={place} target={resolved} needs={module.spec.optionalTarget ?? needs} enabled={fixture === null && !snapshot && (!!module.spec.optionalTarget || !["browser","host"].includes(needs))} />;
  if (snapshot && !pose) return <p role="status">This route was never published at this point, or its Page is ambiguous</p>;
  // The recorded-point verbs (capture, compare, live) open from the Timeline, the topbar's history door.
  const recorded = <RecordedPoints document={snapshot?.point.history.address ?? target.workAddress} route={module.spec.key} address={place.address} snapshot={snapshot} compare={compare} />;
  return <section className="flex min-h-0 flex-1 flex-col" data-url-settled={urlSettled ? "" : undefined} data-tone={history ? "caution" : undefined} data-wash={history ? "" : undefined} aria-label={history ? "Recorded view, read-only" : undefined}>
      {problem ? <>{document}<p role="alert">{problem}</p></> : mount ? <TypedChrome mount={mount} document={document} recorded={recorded} thread={params.get("thread") ?? undefined} /> : <>{document}<p role="status">{target.resolution.kind === "failed" ? target.resolution.message : target.bindingLost?.sentence ?? "Document unavailable; choose an exact document again."}</p></>}
    </section>;

}
export function TypedChrome({ mount, document, recorded, thread }: { mount: TypedMount; document: ReactNode; recorded?: ReactNode; thread?: string }) {
  useSyncExternalStore(mount.subscribe,mount.revision,mount.revision);
  const { spec }=mount;
  const readiness = mount.readiness(), problem = mount.problem();
  const visible=useContext(RouteVisibility), portal=useHasGlobalNavigation();
  const [panes,setPanes]=useState<GraphLayoutState>(()=>readLayoutState(`route:${spec.key}`));
  const slot=usePaneActionSlot();
  const subject=useMemo(()=>typedSubjectDoor(mount),[mount]);
  const codec=mount.attention;
  const currentTarget = mount.target();
  const view = <PlaceView view={{ route:spec.key,thread,codec,visible,surface:"route",page:mount.page.read(),
    context:{ document: currentTarget?.kind === "document" ? currentTarget.ref : null, work: mount.work()?.handle.key ?? null },facts:{},apply:patch=>{
    if (!mount.available()) return {ok:false,refusal:refuse("not-ready","Reveal this Place before changing its Page")};
    mount.move(patch as Record<string,unknown>,"push"); return {ok:true,moved:true,receipt:{current:()=>visible,rendered:page=>canonicalRouteInput(page)===canonicalRouteInput(mount.page.read())}};
  } }} />;
  const head=<SituationBand name={spec.name} context={<>{document}<TypedSubject mount={mount} />{spec.edits && mount.work()?<span>{`r${mount.work()!.revision}`}</span>:null}</>}
    alerts={<><span role="status" aria-label="Route readiness" data-readiness={readiness.kind}>{readiness.kind !== "ready" && readiness.reason !== problem ? readiness.reason : null}</span>{mount.value().value!==undefined&&!mount.value().current?<span role="status">{retainedValueLabel(mount.value())}</span>:null}{problem ? <span role="alert">{problem}</span> : null}{mount.absentOwners().map(owner=>{const route=routeOf(owner);return <span key={owner}>Work is absent: {route?<a href={routeAddress(route).link()}>Start {owner}</a>:owner}</span>;})}<CatalogWorkReviews mount={mount} /></>}
    verbs={[...(mount.startAction()?[<TypedStart key="start" mount={mount}/>]:[]),...Object.keys(spec.commands).map(id=><TypedWrite key={id} mount={mount} id={id} />),
      // An explicit-demand read is a verb the person presses; nothing else re-reads from chrome.
      ...Object.entries(spec.panes).filter(([,p])=>p.read?.demand === "explicit").map(([id,p])=><Button key={`read:${id}`} label={`Read ${p.title}`} onClick={()=>mount.refresh(p.read)}>Read</Button>)]}
    timeline={<TimelineHead owner={mount} history={<>{recorded}<GraphHistory owner={mount} /></>} />} />;
  return <SubjectDoor.Provider value={subject}>{view}<KeyScopeHost id={`route:${spec.key}`} hidden={!visible} className="flex min-h-0 flex-1 flex-col">
    <ScopeKeys keys={actionScopeKeys((["undo","redo"] as const).map(direction=>({id:`work.${direction}`,label:direction,bindings:direction==="undo"?["Mod+Z"]:["Mod+Shift+Z","Mod+Y"],
      options:{ignoreInputs:true},invoke:()=>{if(visible) void mount.history[direction]();}})))} />
    {portal ? <PrimaryRouteControls route={spec.key} slot="situation">{head}</PrimaryRouteControls> : head}
    <GraphLayoutView layout={layout(spec.layout)} panes={Object.fromEntries(Object.entries(spec.panes).map(([id,p])=>[id,{label:p.title,purpose:p.purpose,draws:[],verbs:[]}]))}
      active={when=>when === "subject" && !!spec.subject && (mount.page.read()[spec.subject.field]?.kind === "all" || !!mount.page.read()[spec.subject!.field]?.ids?.length)} state={{panes,onChange:next=>{setPanes(next);writeLayoutState(`route:${spec.key}`,next);}}}
      bodies={Object.fromEntries(Object.entries(spec.panes).map(([id,p])=>[id,pane=>pane(mount.draw(id,ctx=><TypedPane mount={mount} id={id} ctx={ctx} />) as ReactNode,{...paneFrame(p.body),actions:slot(id),busy:paneBusy(mount,p)})]))} />
  </KeyScopeHost></SubjectDoor.Provider>;
}
export function TypedWrite({ mount, id }: { mount: TypedMount; id: string }) {
  const command=mount.spec.commands[id]!,handle=mount.action(id);
  if("kind" in command) return <><Button label={handle.label} refusal={handle.refusal} busy={handle.pending} onClick={()=>void handle.run().catch(()=>{})}>{handle.label}</Button>
    {handle.failure?<span role="alert">{handle.failure}</span>:null}
    {handle.consent?<Button label={`Reject ${handle.label}`} onClick={handle.consent.run}>Reject? {handle.consent.until}</Button>:null}</>;
  return <PreviewAction handle={handle} label={handle.label} />;
}
/** Subject discovery precedes Work selection and acquisition. */
export function TypedSubject({ mount }: { mount: TypedMount }) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  const subject = mount.spec.subject;
  if (!subject) return null;
  // One capability has one choice path: a declared subject-list pane owns subject choice, even when hidden.
  if (Object.values(mount.spec.panes).some(pane => pane.subjectList)) return null;
  const roster = mount.value(subject.read ?? mount.spec.core);
  if (!roster.current) return <OutcomeLine kind={roster.status === "pending" ? "busy" : "refused"} label={`Choose ${subject.noun}`} says={roster.reason} />;
  return <SubjectPicker data={mount.data} single={subject.multiple === false} mount={{
    picker: () => subject.options(roster.value), page: mount.page,
    controls: { subject: mount.page.subject },
  }} />;
}
const still = () => () => {};
/** Slice 6.1: a pane says `aria-busy` while a reading it draws is pending (first read or refresh);
 *  a route never sets it. A pane with no read of its own draws the core; the subject list, the roster. */
const paneBusy = (mount: TypedMount, pane: TypedMount["spec"]["panes"][string]) =>
  [pane.read ?? mount.spec.core, pane.subjectList ? mount.spec.subject?.read : undefined].some(read => !!read && mount.value(read).status === "pending");
function layout(node: TypedRoute["spec"]["layout"]): LayoutNode {
  return node.kind==="split"?{...node,sized:node.sized??"end",minSize:node.minSize??80,minOtherSize:node.minOtherSize??80,children:node.children.map(layout)}:node.kind==="gate"?{...node,child:layout(node.child)}:node;
}
export function TypedShell(props: Parameters<typeof TypedRouteView>[0]) {
  return <PaneActionSlots><TypedRouteView {...props} /></PaneActionSlots>;
}
export function HostedTypedRoute({ module, fingerprint, ...props }: Parameters<typeof TypedRouteView>[0] & HostedRouteProps) {
  const address = useMemo(() => hostedRouteAddress(module,props),[module,props.thread,props.target,props.work]);
  return props.visible ? <TypedShell module={module} fingerprint={fingerprint} address={address} /> : null;
}

function TypedPane({mount,id,ctx}: {mount:TypedMount;id:string;ctx:DrawContext<any,any,any,any>}) {
  const bindings=mount.spec.panes[id]!.bindings?.(ctx);
  const document=ctx.target?.kind === "document"?ctx.target.ref:null;
  const doc=document?`${document.session}/${document.openId}`:`${mount.spec.key}:unbound`;
  const selected=useMemo(()=>Atom.make(()=>new Set(bindings?.selected??[])),[bindings?.selected]);
  const observation=bindings?.observation??{scope:null,references:[]};
  // Bindings rebuild their references every render; the index changes only when the pairs do.
  const refs=(observation.references??[]) as readonly {elementId:number;uniqueId?:string|null}[];
  const pairs=refs.map(r=>`${r.elementId}=${r.uniqueId??""}`).join();
  const elements=useMemo(()=>elementIndex(refs),[pairs]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ValueScope value={ctx.value}><AttentionScope doc={doc} selected={selected} members={bindings?.members} elements={elements}>
    <NativeObservationScope value={ctx.value.current?observation:{...observation,scope:null}}>
      {mount.spec.panes[id]!.read!==mount.spec.core&&retainedValueLabel(ctx.value)?<p role="status">{retainedValueLabel(ctx.value)}</p>:null}
      {kernelPane(mount, id, ctx) ?? mount.spec.panes[id]!.draw(ctx).node}
    </NativeObservationScope>
  </AttentionScope></ValueScope>;
}

function TypedStart({mount}:{mount:TypedMount}) {
  const action=mount.startAction();
  if(!action) return null;
  return <><Button label="Start" refusal={action.refusal} busy={action.pending} onClick={()=>void action.run().catch(()=>{})}>Start</Button>
    {action.refusal?<span role="status">Start unavailable: {action.refusal}</span>:null}
    {action.consent?<Button label="Reject Start" onClick={action.consent.run}>Reject? {action.consent.until}</Button>:null}
    {action.failure?<span role="alert">{action.failure}</span>:null}</>;
}

export function retainedValueLabel(value:{current:boolean;status:string;value?:unknown}) {
  return value.current||value.value===undefined?null:value.status === "pending"?"Showing previous Value; refreshing":"Showing previous Value; refresh needed";
}

type View = Parameters<typeof useRouteViewBridge>[0];
function createViews() {
  const entries = new Map<string, { view: View; current(): boolean }>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => { revision++; for (const listener of listeners) listener(); };
  return {
    entries,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    revision: () => revision,
    put(id: string, view: View, current: () => boolean) { entries.set(id, { view, current }); changed(); },
    remove(id: string) { if (entries.delete(id)) changed(); },
  };
}
const PlaceViews = createContext<ReturnType<typeof createViews> | null>(null);
export function usePlaceViews() { return useMemo(createViews, []); }
export const PlaceViewsProvider = PlaceViews.Provider;

/** The selected Place keeps its context when Activity folds its drawing and disconnects effects. */
export function PlaceView({ view }: { view: View }) {
  const views = useContext(PlaceViews);
  return views ? <RetainedView views={views} view={view} /> : <DirectView view={view} />;
}
function DirectView({ view }: { view: View }) { useRouteViewBridge(view); return null; }
function RetainedView({ views, view }: { views: ReturnType<typeof createViews>; view: View }) {
  const id = useMemo(() => crypto.randomUUID(), []), current = useRouteCurrent();
  useLayoutEffect(() => { views.put(id, view, current); });
  // Insertion cleanup follows removal, whereas Activity disconnects layout/passive effects on fold.
  useInsertionEffect(() => () => { queueMicrotask(() => views.remove(id)); }, [views, id]);
  return null;
}
export function PublishedPlaceViews({ views }: { views: ReturnType<typeof createViews> }) {
  useSyncExternalStore(views.subscribe, views.revision, views.revision);
  return [...views.entries].map(([id, entry]) => <PublishedView key={id} view={{ ...entry.view, thread: undefined, visible: entry.current() }} />);
}
function PublishedView({ view }: { view: View }) { useRouteViewBridge(view); return null; }

/** ADR 0035 rules 3 and 8: the sheet and goal slots draw here, the same way on every route, builtin or Pod. */
function kernelPane(mount: TypedMount, id: string, ctx: Parameters<TypedMount["spec"]["panes"][string]["draw"]>[0]): ReactNode | null {
  const kernel = (mount.spec.panes[id] as { kernel?: "sheet" | "goal" }).kernel;
  if (kernel === "sheet" && mount.spec.sheet)
    return <SheetPane ctx={{ draw: ctx as never, slot: mount.spec.sheet, field: mount.spec.subject?.field }} />;
  if (kernel === "goal") return <GoalPane ctx={{ goal: ctx.value.value as Goal | undefined }} />;
  return null;
}
