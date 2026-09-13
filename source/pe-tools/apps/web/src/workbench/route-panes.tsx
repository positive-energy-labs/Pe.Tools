/**
 * Chat's in-realm panes: the same route bodies, drawn inside a thread. Each pane keys on the
 * thread head's default Target, so a pane and its route always read the same Work.
 */
import { LiveScheduleGridWorkspace } from "#/schedule-grid/live";
import { SettingsRouteContent } from "#/routes/settings";
import { FamilyRouteContent } from "#/routes/family";
import { TakeoffsPane } from "#/takeoff/pane";
import { takeoffsRouteState, workKey, type WorkKey } from "@pe/agent-contracts";
import { useThreadScope } from "#/chat/scope";
import { useWorkbench } from "./provider";
import { InstancesPage } from "#/instances/route";
import type { ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import {
  familiesRouteState,
  familyRouteState,
  instancesRouteState,
  parameterLinksRouteState,
  scheduleGridRouteState,
  settingsRouteState,
  type RouteStatePatch,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import type { z } from "zod";

import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { createRouteOwner, docAtom, docWriter, useRouteOwner } from "#/route";
import { previousOf } from "#/readings";
import type { ChatPageStore } from "./store";
import type { ChatPluginRoute } from "./route-chat-plugins";

type PaneProps = { store: ChatPageStore };
type Pane = (props: PaneProps) => ReactNode;

const routePaneSpecs = {
  instances: instancesRouteState,
  takeoffs: takeoffsRouteState,
  family: familyRouteState,
  families: familiesRouteState,
  settings: settingsRouteState,
  "parameter-links": parameterLinksRouteState,
  "schedule-grid": scheduleGridRouteState,
} satisfies Record<ChatPluginRoute, RouteStateSpec<z.ZodType>>;

export const ROUTE_PANE_ROUTES = Object.keys(routePaneSpecs) as ChatPluginRoute[];
const routePanes = Object.fromEntries(
  Object.entries(routePaneSpecs).map(([route, spec]) => [
    route,
    ({ store }: PaneProps) => <RoutePaneOwner chat={store} spec={spec} />,
  ]),
) as Record<ChatPluginRoute, Pane>;

export function selectRoutePane(route: ChatPluginRoute): Pane {
  return routePanes[route];
}

function RoutePaneOwner({ chat, spec }: { chat: ChatPageStore; spec: RouteStateSpec<z.ZodType> }) {
  const { currentThreadId } = useWorkbench();
  const threadScope = useThreadScope(currentThreadId);
  const work: WorkKey = {
    route: spec.route,
    target: threadScope.defaultTarget?.kind === "named" ? threadScope.defaultTarget.address : null,
  };
  if (!threadScope.hydrated)
    return (
      <EmptyState story="scope" exit="wait for the thread head">
        opening {spec.title}
      </EmptyState>
    );
  if (spec.route === "settings") return <SettingsRouteContent mode="file" />;
  if (spec.route === "family") return <FamilyRouteContent mode="file" />;
  if (spec.route === "takeoffs")
    return <TakeoffsPane key={workKey(work)} scope={work} />;
  if (spec.route === "schedule-grid") return <LiveScheduleGridWorkspace key={workKey(work)} />;
  if (spec.route === "instances")
    return <InstancesPage target={work.target ?? ""} setTarget={() => {}} />;
  return <ScopedRoutePaneOwner key={workKey(work)} chat={chat} spec={spec} work={work} />;
}

function ScopedRoutePaneOwner({
  chat,
  spec,
  work,
}: {
  chat: ChatPageStore;
  spec: RouteStateSpec<z.ZodType>;
  work: WorkKey;
}) {
  const store = useRouteOwner(() => createRoutePaneStore(chat, spec, work));
  return <RoutePane store={store} />;
}

function RoutePane({ store }: { store: RoutePaneStore }) {
  const reading = useAtomValue(store.slice);
  const { spec } = store;
  const value = previousOf(reading);
  const error = reading.state === "failed" ? reading.message : null;
  if (!value) {
    return (
      <EmptyState
        story="scope"
        exit={error ? "restore the Work reading" : "wait for the Work reading"}
      >
        {error ?? `opening ${spec.title}`}
      </EmptyState>
    );
  }
  const { doc, revision } = value;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-baseline gap-3 border-b px-4 py-2">
        <h2 className="text-sm font-medium">{spec.title}</h2>
        <OutcomeLine
          kind={error ? "refused" : "receipt"}
          label={error ?? (reading.state === "ready" ? "Work current" : "Work stale")}
        />
      </header>
      {doc == null ? (
        <EmptyState story="scope" exit="bind or open the route document">
          no document is open
        </EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <textarea
            key={JSON.stringify(doc)}
            aria-label={`${spec.title} document`}
            defaultValue={JSON.stringify(doc, null, 2)}
            className="mt-3 min-h-[70vh] w-full resize-y p-3"
            onBlur={(event) => {
              try {
                const next: unknown = JSON.parse(event.currentTarget.value);
                const patches = topLevelPatches(doc, next);
                if (patches.length)
                  void store.actions.apply(patches, revision ?? 0).catch(() => undefined);
              } catch {
                event.currentTarget.value = JSON.stringify(doc, null, 2);
              }
            }}
          />
        </div>
      )}
    </section>
  );
}

function createRoutePaneStore(chat: ChatPageStore, spec: RouteStateSpec<z.ZodType>, work: WorkKey) {
  const core = createRouteOwner(`pane/${spec.route}`, chat.registry);
  // Shared family atom, never a labelled clone: one events stream per route document.
  const slice = docAtom(spec, work);
  const searchState = core.owned("page/search", Atom.make({ target: work.target ?? "" }));
  const search = {
    get target() {
      return chat.registry.get(searchState).target;
    },
    patch(partial: { target?: string }) {
      core.write("set-search", "page/search", () =>
        chat.registry.update(searchState, (previous) => ({ ...previous, ...partial })),
      );
    },
  };
  const writer = docWriter(spec, work, chat.registry, slice);
  return {
    registry: chat.registry,
    spec,
    slice,
    search,
    atoms: { search: searchState },
    actions: {
      apply: (patches: RouteStatePatch[], revision: number) =>
        core.runAction(
          "apply",
          async () => {
            return writer.apply(patches, revision);
          },
          [spec.route],
        ),
    },
    dispose: () => core.dispose(),
  };
}

type RoutePaneStore = ReturnType<typeof createRoutePaneStore>;

export function topLevelPatches(before: unknown, after: unknown): RouteStatePatch[] {
  if (!isRecord(before) || !isRecord(after)) throw Error("route documents must be JSON objects");
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
    JSON.stringify(before[key]) === JSON.stringify(after[key])
      ? []
      : [{ path: [key], ...(key in after ? { value: after[key] } : {}) }],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
