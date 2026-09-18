/**
 * Chat's in-realm panes: the same route bodies, drawn inside a thread. Each pane keys on the
 * thread head's default Target, so a pane and its route always read the same Work.
 */
import { LiveScheduleGridWorkspace } from "#/route/schedules/live";
import { PodsRouteContent } from "#/routes/pods";
import { FamilyRouteView } from "#/route/family/live";
import { FamiliesRouteContent } from "#/routes/families";
import { ParameterLinksRouteContent } from "#/routes/parameter-links";
import { TakeoffsPane } from "#/takeoff/pane";
import { takeoffsRouteState, workKey, type WorkKey } from "@pe/agent-contracts";
import { useThreadScope } from "#/chat/scope";
import { useWorkbench } from "./provider";
import { InstancesPage } from "#/instances/route";
import { useState, type ReactNode } from "react";
import {
  familiesRouteState,
  instancesRouteState,
  parameterLinksRouteState,
  scheduleGridRouteState,
  settingsRouteState,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import type { z } from "zod";

import { EmptyState } from "#/components/lang/empty";
import { useTargetInventory } from "#/readings";
import type { ChatPluginRoute } from "./route-chat-plugins";

type PaneProps = { store: import("./store").ChatPageStore };
type Pane = (props: PaneProps) => ReactNode;

const routePaneSpecs = {
  instances: instancesRouteState,
  takeoffs: takeoffsRouteState,
  families: familiesRouteState,
  pods: settingsRouteState,
  "parameter-links": parameterLinksRouteState,
  schedules: scheduleGridRouteState,
} satisfies Partial<Record<ChatPluginRoute, RouteStateSpec<z.ZodType>>>;

const routePanes = {
  ...Object.fromEntries(
    Object.entries(routePaneSpecs).map(([route, spec]) => [
      route,
      ((_: PaneProps) => <RoutePaneOwner spec={spec} />) satisfies Pane,
    ]),
  ),
  family: ((_: PaneProps) => <FamilyPane />) satisfies Pane,
} as Record<ChatPluginRoute, Pane>;
export const ROUTE_PANE_ROUTES = Object.keys(routePanes) as ChatPluginRoute[];

export function selectRoutePane(route: ChatPluginRoute): Pane {
  return routePanes[route];
}

function FamilyPane() {
  const { currentThreadId } = useWorkbench();
  return <FamilyRouteView thread={currentThreadId} url={false} />;
}

function RoutePaneOwner({ spec }: { spec: RouteStateSpec<z.ZodType> }) {
  const { currentThreadId } = useWorkbench();
  const threadScope = useThreadScope(currentThreadId);
  const inventory = useTargetInventory();
  const target = threadScope.defaultTarget;
  const session =
    target?.kind === "open" && inventory.kind === "ready"
      ? inventory.sessions[target.ref.session]
      : undefined;
  const address =
    target?.kind === "named"
      ? target.address
      : target?.kind === "open" && session?.kind === "ready"
        ? (session.values.find((document) => document.openId === target.ref.openId)?.address ??
          null)
        : null;
  const work: WorkKey = {
    route: spec.route,
    target: address,
  };
  if (!threadScope.hydrated)
    return (
      <EmptyState story="scope" exit="wait for the thread head">
        opening {spec.title}
      </EmptyState>
    );
  // The settings pane is the pods browser: the same member editor /pods draws.
  if (spec.route === settingsRouteState.route) return <PodsPane />;
  if (spec.route === "families") return <FamiliesRouteContent thread={currentThreadId} />;
  if (spec.route === "takeoffs") return <TakeoffsPane key={workKey(work)} scope={work} />;
  if (spec.route === scheduleGridRouteState.route)
    return <LiveScheduleGridWorkspace key={workKey(work)} thread={currentThreadId} />;
  if (spec.route === "instances")
    return <InstancesPage target={work.target ?? ""} setTarget={() => {}} />;
  return <ParameterLinksRouteContent />;
}

function PodsPane() {
  const { currentThreadId } = useWorkbench();
  const [ref, select] = useState<{ pod?: string; path?: string }>({});
  return <PodsRouteContent {...ref} thread={currentThreadId} select={select} />;
}
