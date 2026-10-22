import type { ChatPluginRoute } from "./chat-plugins";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createRouteOwner } from "#/route/route-owner";
import type { RouteKey, LinkPage, DocumentRequest, Carry } from "@pe/agent-contracts";

export interface ChatSearch {
  readonly thread?: string;
  readonly mode: string;
  readonly turn?: number;
  readonly prompt?: string;
  patch(partial: Partial<Omit<ChatSearch, "patch">>, replace?: boolean): Promise<void>;
}

type Setter<A> = A | ((previous: A) => A);

export function createChatPageStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  search: ChatSearch;
}) {
  let tabs: {
    open: (
      route: string,
      page?: LinkPage<RouteKey>,
      carry?: Pick<Carry, "target" | "work">,
    ) => Promise<boolean>;
  } | null = null;
  let createThread:
    | ((expected: string, target: DocumentRequest | null) => Promise<string | null>)
    | null = null;
  let planGeneration = 0;
  const core = createRouteOwner("chat", deps.registry);
  const paletteOpen = core.owned("widget/palette-open", Atom.make(false));
  const expandedPane = core.owned("widget/expanded-pane", Atom.make<"side" | null>("side"));
  /** The head's commit verb, waiting for its hosted route to run it once (page state, not URL). */
  const planIntent = core.owned(
    "widget/plan-intent",
    Atom.make<{ route: ChatPluginRoute; nonce: number } | null>(null),
  );
  /** The head's last plan, refused in its hosted route: said on the head line where it was pressed. */
  const planRefusal = core.owned(
    "widget/plan-refusal",
    Atom.make<{ route: ChatPluginRoute; message: string } | null>(null),
  );
  const sideOpen = Atom.map(expandedPane, (pane) => pane === "side");

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    core.write(verb, atom.label?.[0] ?? "page", () =>
      deps.registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const setPaneOpen = (pane: "side", value: Setter<boolean>) =>
    set(`set-${pane}`, expandedPane, (previous) => {
      const open = typeof value === "function" ? value(previous === pane) : value;
      return open ? pane : previous === pane ? null : previous;
    });
  return {
    registry: deps.registry,
    search: deps.search,
    atoms: {
      paletteOpen,
      sideOpen,
      planIntent,
      planRefusal,
    },
    actions: {
      connectThread: (create: NonNullable<typeof createThread>) => {
        createThread = create;
        return () => {
          if (createThread === create) createThread = null;
        };
      },
      ensureThread: (expected: string, target: DocumentRequest | null) => {
        if (!createThread) return Promise.reject(Error("Chat is not ready to create this thread."));
        return createThread(expected, target);
      },
      setPaletteOpen: (value: Setter<boolean>) => set("set-palette", paletteOpen, value),
      setSideOpen: (value: Setter<boolean>) => setPaneOpen("side", value),
      setMode: (mode: string) => void deps.search.patch({ mode }),
      connectTabs: (commands: NonNullable<typeof tabs>) => {
        tabs = commands;
        return () => {
          if (tabs === commands) tabs = null;
        };
      },
      cancelPlan: () => {
        planGeneration++;
        deps.registry.set(planIntent, null);
      },
      openTab: <R extends RouteKey>(
        route: R,
        page?: LinkPage<R>,
        carry?: Pick<Carry, "target" | "work">,
      ) => tabs?.open(route, page, carry) ?? Promise.resolve(false),
      /** Existing transcript/head entry point. Old group paths cannot identify a route Place. */
      setPlugin: (route?: ChatPluginRoute, group?: readonly string[]) => {
        planGeneration++;
        deps.registry.set(planIntent, null);
        if (!route || group?.length) {
          set("open-unavailable", planRefusal, {
            route: route ?? "chat",
            message: group?.length
              ? "This group link is unavailable; open the route and choose its exact subject."
              : "Choose a route Place to open.",
          });
          return;
        }
        set("open", planRefusal, null);
        void tabs?.open(route);
      },
      /**
       * The head's commit verb (K3): open the route's pane UNSCOPED (plan consumes the whole staged
       * set, so no group filter may hide part of it) and ask its Situation to run its own commit
       * once. Posts nothing to the thread; it is a route action, never a message.
       */
      planIn: (route: ChatPluginRoute) => {
        const generation = ++planGeneration;
        set("plan-in", planRefusal, null);
        void tabs?.open(route, {}).then((opened) => {
          if (opened && generation === planGeneration)
            set("plan-in", planIntent, { route, nonce: Date.now() });
        });
      },
      /** The hosted route took the intent; true only for the first taker. */
      takePlan: (plugin: ChatPluginRoute) => {
        if (deps.registry.get(planIntent)?.route !== plugin) return false;
        deps.registry.set(planIntent, null);
        return true;
      },
      refusePlan: (plugin: ChatPluginRoute, message: string) =>
        set("plan-refused", planRefusal, { route: plugin, message }),
      openThread: (thread: string, replace = false) =>
        deps.search.patch({ thread, prompt: undefined, turn: undefined }, replace),
    },
    runAction: core.runAction,
    dispose() {
      core.dispose();
    },
  };
}

export type ChatPageStore = ReturnType<typeof createChatPageStore>;
