import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { GraphLayoutView, type GraphLayoutState } from "@pe/kit";
import { Button } from "@pe/kit/lang/button";
import { WriteAction } from "@pe/kit/lang/write-action";
import { KeyScope, ScopeKeys, actionScopeKeys } from "@pe/kit/keys";
import { canonicalRouteInput, type LayoutNode } from "@pe/agent-contracts";
import { useRouteTarget } from "../route/route-target";
import { appAtomRegistry } from "./owner";
import { admittedRouterAddress } from "./admitted-pane";
import { createAdmittedPlace, type PlaceInput } from "./admitted-place";
import { HistoryBoundary, HistoryRail } from "./history-rail";
import { historyRequest, publicationPose, type HistorySnapshot } from "./history";
import { DocumentPicker } from "./application-route-shell";
import { RouteVisibility, useRouteActivity } from "../route/activity";
import { SituationBand, TimelineHead } from "./situation-band";
import { writeHeld, writeReject, CatalogWorkReviews } from "./admitted-chrome";
import { readLayoutState, writeLayoutState } from "./mount-page";
import { GraphHistory } from "./mount-timeline";
import { PaneActionSlots, usePaneActionSlot } from "./pane-actions";
import { SubjectDoor } from "./subject";
import { openSet } from "./open-set.neutral";
import { PrimaryRouteControls, useHasGlobalNavigation } from "../navigation/route-controls";
import { useRouteViewBridge } from "../route/view-bridge";
import { harnessClient } from "../workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "../workbench/config";
import { mountTypedRoute, type TypedMount } from "./typed-mount";
import type { TypedRoute } from "../route/typed-route";
import type { RouteFingerprint } from "@pe/agent-contracts";
import type { AdmittedAddressPort } from "./admitted-address";
import { hostedRouteAddress, type HostedRouteProps } from "../workbench/hosted-route";

/** A typed route bypasses web admission. Only its host Work registration needs the closure stamp. */
export function TypedRouteView({ module, fingerprint, address: supplied }: { module: TypedRoute; fingerprint: RouteFingerprint; address?: AdmittedAddressPort }) {
  const router = useRouter(), activity = useRouteActivity(), visible = useContext(RouteVisibility);
  const address = useMemo(() => supplied ?? admittedRouterAddress(router.history), [router,supplied]);
  const [place, setPlace] = useState<ReturnType<typeof createAdmittedPlace<{ mount: TypedMount; dispose(): void }>> | null>(null);
  const held = useRef<typeof place>(null);
  const lifetime = useRef({ module, address, activity });
  useEffect(() => {
    if(held.current && (lifetime.current.module!==module || lifetime.current.address!==address || lifetime.current.activity!==activity)) {
      if(lifetime.current.activity) lifetime.current.activity.retire(held.current); else held.current.dispose();
      held.current=null;
    }
    lifetime.current={module,address,activity};
    const p = held.current ?? createAdmittedPlace<{ mount: TypedMount; dispose(): void }>({ address,
      search: activity ? new URLSearchParams(Object.entries(activity.search).filter((e): e is [string,string] => typeof e[1] === "string")) : address.read(),
      visible, scope: activity ?? { pathname: `/${module.spec.key}`, search: {}, current: () => true, retain() {}, retire() {} } });
    held.current=p; p.setVisible(visible); setPlace(p);
    return () => { p.setVisible(false); if(!activity) {p.dispose();held.current=null;} };
  }, [module, address, activity]);
  useEffect(() => { place?.setVisible(visible); }, [place,visible]);
  return place ? <HistoryBoundary address={place.address}>{snapshot => <TypedPlace module={module} place={place} fingerprint={fingerprint} snapshot={snapshot} />}</HistoryBoundary> : null;
}
function TypedPlace({ module, place, fingerprint, snapshot }: { snapshot?: HistorySnapshot; module: TypedRoute; place: ReturnType<typeof createAdmittedPlace<{ mount: TypedMount; dispose(): void }>>; fingerprint: RouteFingerprint }) {
  const search = useSyncExternalStore(place.address.subscribe, () => place.address.read().toString());
  const fixture = place.fixture, visible = useContext(RouteVisibility);
  const params = new URLSearchParams(search), compare = !!snapshot && params.get("compare") === "now";
  const history = compare ? undefined : snapshot;
  const [liveInstance] = useState(() => `${module.spec.key}:${crypto.randomUUID()}`);
  const poses = snapshot?.point.history.poses.filter(p => p.route === module.spec.key && (!params.get("atInstance") || p.instance === params.get("atInstance"))) ?? [];
  const pose = poses.length === 1 ? poses[0] : undefined, instance = pose?.instance ?? liveInstance;
  const seed = useMemo(() => history ? { target: { kind: "document" as const, ref: history.point.history.target } } : fixture === null ? undefined : {}, [history,fixture]);
  const target = useRouteTarget({ needs: "project" }, appAtomRegistry, seed, compare ? snapshot.point.history.address : params.get("target"));
  const resolved = target.resolution.kind === "resolved" ? target.resolution.target : null;
  const signature = canonicalRouteInput([resolved, target.workAddress, target.workOpen, history?.point.id, !!snapshot, instance]);
  const current = useRef(signature); current.current = signature;
  const input = useMemo<PlaceInput>(() => ({ address: place.address, fixture, target: resolved, history, readOnly: !!snapshot, publicationInstance: instance,
    work: { address: history?.point.history.address ?? target.workAddress, open: resolved?.kind === "document" ? resolved.ref : target.workOpen },
    custody: { current: () => place.current() && current.current === signature }, memory: history ? () => pose?.page ?? {} : place.memory }), [place,signature]);
  const [mount,setMount] = useState<TypedMount | null>(null);
  const [problem,setProblem] = useState<string | null>(null);
  useEffect(() => {
    place.setVisible(visible);
    if (snapshot && !pose || !input.target && !input.work.address && !input.work.open) return;
    let state: { mount: TypedMount; input?: PlaceInput; dispose(): void };
    try {
      state = place.state(() => ({ mount: mountTypedRoute(module,input,fingerprint), input, dispose() { this.mount.dispose(); } }));
      if (state.input !== input) { state.mount.dispose(); state.mount=mountTypedRoute(module,input,fingerprint); state.input=input; }
      setMount(state.mount); setProblem(null);
    } catch(error) { setProblem(String(error)); return; }
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
  const document = <DocumentPicker place={place} target={resolved} needs="project" enabled={fixture === null && !snapshot} />;
  if (snapshot && !pose) return <p role="status">This route was never published at this point, or its Page is ambiguous</p>;
  return <><HistoryRail document={snapshot?.point.history.address ?? target.workAddress} route={module.spec.key} address={place.address} snapshot={snapshot} compare={compare} />
    <section className="flex min-h-0 flex-1 flex-col" data-tone={history ? "caution" : undefined} data-wash={history ? "" : undefined} aria-label={history ? "Recorded view, read-only" : undefined}>
      {problem ? <p role="alert">{problem}</p> : mount ? <TypedChrome mount={mount} document={document} /> : <>{document}<p>Choose a document</p></>}
    </section></>;

}
function TypedChrome({ mount, document }: { mount: TypedMount; document: ReactNode }) {
  useSyncExternalStore(mount.subscribe,mount.revision,mount.revision);
  const { spec }=mount;
  const visible=useContext(RouteVisibility), portal=useHasGlobalNavigation();
  const [panes,setPanes]=useState<GraphLayoutState>(()=>readLayoutState(`route:${spec.key}`));
  const slot=usePaneActionSlot();
  const subject=useMemo(()=>{
    const update=(op:(set:ReturnType<typeof openSet<unknown>>,value:any)=>unknown)=>{
      const value=mount.value(spec.subject.read ?? spec.core).value;
      const set=openSet<unknown>(canonicalRouteInput,value?spec.subject.options(value).map(o=>o.id):[]);
      mount.page.subject(op(set,mount.page.read()[spec.subject.field]));
    };
    return { toggle:(id:unknown)=>update((set,value)=>set.toggle(value,id)), add:(ids:readonly unknown[])=>update((set,value)=>set.add(value,ids)),
      remove:(id:unknown)=>update((set,value)=>set.remove(value,id)),setActive:(id:unknown)=>update((set,value)=>set.setActive(value,id)),
      all:()=>mount.page.subject({kind:"all"}),clear:()=>mount.page.subject({kind:"ids",ids:[]}) };
  },[mount]);
  const codec=mount.attention;
  useRouteViewBridge({ route:spec.key,codec,visible,surface:"route",page:mount.page.read(),context:{},facts:{},apply:patch=>{
    mount.move(patch as Record<string,unknown>,"push"); return {ok:true,moved:true,receipt:{current:()=>visible,rendered:page=>canonicalRouteInput(page)===canonicalRouteInput(mount.page.read())}};
  } });
  const head=<SituationBand name={spec.name} context={<>{document}<span>{mount.work()?.revision === undefined ? "Reading Work..." : `r${mount.work()!.revision}`}</span></>}
    alerts={<>{mount.problem() ? <span role="alert">{mount.problem()}</span> : null}<CatalogWorkReviews mount={mount} /></>}
    verbs={Object.keys(spec.commands).map(id=><TypedWrite key={id} mount={mount} id={id} />)}
    timeline={<TimelineHead owner={mount} history={<GraphHistory owner={mount} />} />} />;
  return <SubjectDoor.Provider value={subject}><KeyScope id={`route:${spec.key}`}><div className="flex min-h-0 flex-1 flex-col">
    <ScopeKeys keys={actionScopeKeys((["undo","redo"] as const).map(direction=>({id:`work.${direction}`,label:direction,bindings:direction==="undo"?["Mod+Z"]:["Mod+Shift+Z","Mod+Y"],
      options:{ignoreInputs:true},invoke:()=>{if(visible) void mount.history[direction]();}})))} />
    {portal ? <PrimaryRouteControls route={spec.key} slot="situation">{head}</PrimaryRouteControls> : head}
    <GraphLayoutView layout={layout(spec.layout)} panes={Object.fromEntries(Object.entries(spec.panes).map(([id,p])=>[id,{label:p.title,purpose:p.purpose,draws:[],verbs:[]}]))}
      active={when=>when === "subject" && (mount.page.read()[spec.subject.field]?.kind === "all" || !!mount.page.read()[spec.subject.field]?.ids?.length)} state={{panes,onChange:next=>{setPanes(next);writeLayoutState(`route:${spec.key}`,next);}}}
      bodies={Object.fromEntries(Object.keys(spec.panes).map(id=>[id,pane=>pane(mount.draw(id) as ReactNode,{actions:<>{slot(id)}<Button label={`Refresh ${spec.panes[id]!.title}`} onClick={mount.refresh}>Refresh</Button></>})]))} />
  </div></KeyScope></SubjectDoor.Provider>;
}
export function TypedWrite({ mount, id }: { mount: TypedMount; id: string }) {
  const command=mount.spec.commands[id]!,review=mount.review(id),held=writeHeld(command.label,review);
  const run=async(apply=false)=>{try{await mount.run(id,apply);return null;}catch(error){return {message:error instanceof Error?error.message:String(error)};}};
  return <WriteAction label={`plan ${command.label}`} says={`Plan ${command.label} from current Work`}
    held={held.held} stale={held.stale} failed={mount.reviewProblem(id)} plan={()=>run()}
    apply={{label:command.label,says:`${command.label} what the plan sealed`,refusal:held.sealed?null:"Plan the current Work first",run:()=>run(true),done:`${command.label} sent`}}
    reject={writeReject(mount.timeline(),[command.entry],(thread,request)=>void harnessClient(resolveWorkbenchConfig().origin).permission(thread,request,"stop_writes"))} />;
}
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
