import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { workKey, type RouteGraph } from "@pe/agent-contracts";
import { actionScopeKeys, useScopeLive } from "@pe/kit/keys";
import { RouteVisibility, useRouteCurrent, useRouteSearchSlice } from "../route/activity";
import { useRouteOwner } from "#/shell/owner";
import type { RouteHandle } from "../route/handle";
import { LadderPicker, useDocumentLadder } from "../route/situation-ladder";
import { useInitialUrlPage, useUrlPage } from "../route/url";
import { useRouteLease } from "../route/view-bridge";
import { createGraphMount, type GraphMount } from "./mount-owner";
import { graphUrlPage } from "./mount-page";
import type { RouteAdapters } from "./mount-pane";
import { settingFields } from "./settings";
import { useWorkScope, type WorkScopeStatus } from "./use-work-scope";
import { fixtureEnvironment, pendingFixtureEnvironment, fixtureName } from "./fixture";

export interface MountRouteProps {
  hidden?: boolean;
  url?: boolean;
  target?: string;
  work?: string;
  thread?: string;
}

export function GraphLease<P, W>({
  graph,
  owner,
  shown,
  props,
  visible,
}: {
  graph: RouteGraph<P, W>;
  owner: GraphMount<P, W>;
  shown: { context?: Record<string, unknown>; facts?: Record<string, unknown> };
  props: MountRouteProps;
  visible: boolean;
}) {
  useRouteLease(
    graph.address as Parameters<typeof useRouteLease>[0],
    [owner.view.read().page as object, (patch) => owner.view.setPage(patch as Partial<P>)],
    { thread: props.thread, url: props.url, visible, ...shown },
  );
  return null;
}

/** Custom route chrome uses the same owner, target door, URL and availability as mountRoute. */
export function useGraphRoute<P, W>(
  graph: RouteGraph<P, W>,
  adapters: RouteAdapters<P, W>,
  { hidden = false, url: projectUrl = true, thread, target, work }: MountRouteProps = {},
) {
  const fixture = useRouteSearchSlice(fixtureName);
  const pendingLane = useMemo(
    () => (fixture === null ? null : pendingFixtureEnvironment(graph, fixture)),
    [graph, fixture],
  );
  const [loaded, setLoaded] = useState<{
    pending: typeof pendingLane;
    lane: Awaited<ReturnType<typeof fixtureEnvironment<P, W>>>;
  } | null>(null);
  useEffect(() => {
    if (fixture === null) return;
    let active = true;
    void fixtureEnvironment(graph, fixture).then((lane) => {
      if (active) setLoaded({ pending: pendingLane, lane });
    });
    return () => {
      active = false;
    };
  }, [graph, fixture, pendingLane]);
  const lane = loaded && loaded.pending === pendingLane ? loaded.lane : pendingLane;
  const addressThread = useRouteSearchSlice((search) => (projectUrl ? search.thread : undefined));
  const boundThread = thread ?? addressThread;
  const url = useMemo(
    () => graphUrlPage(graph, { ...adapters.initialPage, ...lane?.adapters.initialPage }),
    [graph, adapters.initialPage, lane],
  );
  const addressPage = useInitialUrlPage(projectUrl ? url : null);
  const initial = {
    ...addressPage,
    ...(work !== undefined && graph.workSubject ? { [graph.workSubject]: work } : {}),
  } as Partial<P>;
  // The door follows the owner's Page (its workSubject); before the owner exists, the URL's.
  // The mount re-renders on every Page change, so the next render reads the moved field.
  const mounted = useRef<GraphMount<P, W> | null>(null);
  const scope = useWorkScope(
    graph,
    mounted.current?.view.read().page ?? initial,
    {
      target,
      work,
      thread: boundThread,
      url: projectUrl,
    },
    lane?.ports,
  );
  const owner = useRouteOwner(
    () =>
      createGraphMount(lane?.graph ?? graph, { ...adapters, ...scope, ...lane?.adapters }, initial),
    lane,
  );
  mounted.current = owner;
  useEffect(() => owner.connect(), [owner]);
  useEffect(() => {
    if (work !== undefined && graph.workSubject)
      owner.view.setPage({ [graph.workSubject]: work } as Partial<P>);
  }, [owner, graph.workSubject, work]);
  useUrlPage(projectUrl ? url : null, owner.view);
  useSyncExternalStore(owner.subscribe, owner.version, owner.version);
  const visible = useContext(RouteVisibility);
  const current = useRouteCurrent();
  const live = useScopeLive();
  // An unresolved or closed document's route still draws and reads; it arms no verb.
  const settings = owner.settings.read();
  const settingsReady =
    !Object.keys(settingFields(graph)).length ||
    (settings.revision >= 0 && !settings.pending && !settings.error);
  const armed = settingsReady && (!graph.needs || scope.status.resolution.kind === "resolved");
  owner.setAvailable(() => armed && !hidden && visible && live && current());
  const active = armed && !hidden && visible && live && current();
  const observed = useRef(new Set<string>());
  useEffect(() => {
    if (!active || owner.busy()) return;
    for (const id of graph.observe ?? []) {
      const key = owner.snapshot().work?.handle.key;
      if (!key) continue;
      const identity = `${id}:${workKey(key)}`;
      const control = owner.control(id);
      if (observed.current.has(identity) || control.refusal) continue;
      observed.current.add(identity);
      void control.run();
      break;
    }
  });
  return {
    owner,
    hidden: hidden || !visible || !live || !current(),
    current,
    status: scope.status,
    thread: boundThread,
    hosted: !projectUrl,
  };
}

function nativeUndo(event: KeyboardEvent) {
  const target = event.target;
  return (
    target instanceof Element &&
    !!target.closest(
      "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']",
    )
  );
}

/** Undo/redo restore this Work's journal; a focused text field keeps its own native undo. */
export function journalKeys<P, W>(
  graph: RouteGraph<P, W>,
  owner: GraphMount<P, W>,
  live: () => boolean,
) {
  return actionScopeKeys(
    (["undo", "redo"] as const).map((direction) => ({
      id: `${graph.key}.${direction}`,
      label: direction,
      bindings: direction === "undo" ? ["Mod+Z"] : ["Mod+Shift+Z", "Mod+Y"],
      options: { ignoreInputs: true, preventDefault: false },
      invoke: (event?: KeyboardEvent) => {
        if (!live() || (event && nativeUndo(event))) return false;
        void owner.restore(direction);
      },
    })),
  );
}

/** The old kernel's document ladder and resolution words, over the kernel's Target status. */
export function GraphTarget({ status, disabled }: { status: WorkScopeStatus; disabled: boolean }) {
  // ponytail: useDocumentLadder reads only resolution, bindingLost, targetProvenance and readings.
  const ladder = useDocumentLadder({ readings: {}, ...status } as unknown as RouteHandle<
    unknown,
    string,
    unknown,
    string
  >);
  const { resolution } = status;
  return (
    <>
      <LadderPicker ladder={ladder} disabled={disabled} />
      {resolution.kind === "checking" ? (
        <span role="status" className="text-ink-2">
          checking the inventory
        </span>
      ) : resolution.kind === "failed" ? (
        <span role="alert" data-tone="caution">
          {resolution.message}
        </span>
      ) : resolution.kind === "choose" ? (
        <span role="status" data-tone="caution">
          {status.bindingLost?.sentence ??
            `choose a target — ${resolution.reason.replaceAll("-", " ")}`}
        </span>
      ) : null}
    </>
  );
}
