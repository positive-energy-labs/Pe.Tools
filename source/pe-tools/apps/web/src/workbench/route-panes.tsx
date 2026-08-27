import type { ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import {
  familiesRouteState,
  familyRouteState,
  parameterLinksRouteState,
  scheduleGridRouteState,
  settingsRouteState,
  type Address,
  type RouteStatePatch,
  type RouteStateSpec,
} from "@pe/agent-contracts";
import type { z } from "zod";

import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { createRouteStoreCore, docAtom, docWriter } from "#/state/route-store";
import { useRouteStore } from "#/state/use-route-store";
import type { ChatStore } from "./store";
import type { ChatPluginRoute } from "./route-chat-plugins";
import { RouteWorkspaceShell } from "./route-workspace-shell";
import { RouteDocumentEmpty, useRouteDocumentAddress } from "./route-document";

type PaneProps = { store: ChatStore };
type Pane = (props: PaneProps) => ReactNode;

const routePaneSpecs = {
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

function RoutePaneOwner({ chat, spec }: { chat: ChatStore; spec: RouteStateSpec<z.ZodType> }) {
  const documentAddress = useRouteDocumentAddress();
  if (!documentAddress) return <RouteDocumentEmpty />;
  return <AddressedRoutePaneOwner chat={chat} spec={spec} documentAddress={documentAddress} />;
}

function AddressedRoutePaneOwner({ chat, spec, documentAddress }: { chat: ChatStore; spec: RouteStateSpec<z.ZodType>; documentAddress: Address }) {
  const store = useRouteStore(() => createRoutePaneStore(chat, spec, documentAddress));
  return <RoutePane store={store} />;
}

function RoutePane({ store }: { store: RoutePaneStore }) {
  const result = useAtomValue(store.slice);
  const { spec } = store;
  if (!AsyncResult.isSuccess(result)) {
    return <EmptyState story="scope" exit="wait for the route document">opening {spec.title}</EmptyState>;
  }
  const { doc, connected, error } = result.value;
  return (
    <RouteWorkspaceShell title={spec.title} connected={connected === true} error={error}>
      {doc == null ? (
        <EmptyState story="scope" exit="bind or open the route document">no document is open</EmptyState>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <OutcomeLine kind="receipt" label="document-scoped route document" />
          <textarea
            key={JSON.stringify(doc)}
            aria-label={`${spec.title} document`}
            defaultValue={JSON.stringify(doc, null, 2)}
            className="mt-3 min-h-[70vh] w-full resize-y bg-[var(--r-recess)] p-3 face-mono t-value"
            onBlur={(event) => {
              try {
                const value: unknown = JSON.parse(event.currentTarget.value);
                const patches = topLevelPatches(doc, value);
                if (patches.length) void store.actions.apply(patches).catch(() => undefined);
              } catch {
                event.currentTarget.value = JSON.stringify(doc, null, 2);
              }
            }}
          />
        </div>
      )}
    </RouteWorkspaceShell>
  );
}

function createRoutePaneStore(chat: ChatStore, spec: RouteStateSpec<z.ZodType>, documentAddress: Address) {
  const core = createRouteStoreCore(`pane/${spec.route}`, chat.registry);
  const scope = { documentAddress };
  const slice = core.owned("slice/document", docAtom(spec, scope));
  const searchState = core.owned("page/search", Atom.make({ target: chat.search.target ?? "" }));
  const search = {
    get target() { return chat.registry.get(searchState).target; },
    patch(partial: { target?: string }) {
      core.write("set-search", "page/search", () =>
        chat.registry.update(searchState, (previous) => ({ ...previous, ...partial })),
      );
    },
  };
  const writer = docWriter(spec, scope, chat.registry);
  return {
    registry: chat.registry,
    spec,
    slice,
    search,
    atoms: { search: searchState },
    actions: {
      apply: (patches: RouteStatePatch[]) => core.runVerb("apply", async () => {
        const result = await writer.apply(patches);
        if (!result.ok) throw Error(result.hint ?? result.error ?? "route update failed");
        return result;
      }, [spec.route]),
    },
    dispose: core.dispose,
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
