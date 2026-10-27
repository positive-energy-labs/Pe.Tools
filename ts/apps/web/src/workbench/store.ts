import type { ChatPluginRoute } from "./chat-plugins";
import type { PaneSide } from "@pe/kit/lang/pane";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createRouteOwner } from "#/route/route-owner";
import type { ClosedWork, Resumed } from "#/chat/thread-work";
import { type RouteKey, type LinkPage, type Carry } from "@pe/agent-contracts";

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
  /** `?demo=`: tab writes stay in this browser and never reach a host thread. */
  local?: boolean;
}) {
  let tabs: {
    promote: (owner: string) => Promise<void>;
    sent: (owner: string) => void;
    open: <R extends RouteKey>(
      route: R,
      page?: LinkPage<R>,
      carry?: Pick<Carry, "target" | "work">,
      duplicate?: boolean,
      keep?: boolean,
    ) => Promise<boolean>;
    work: (thread: string, route: string, resumed?: Resumed) => Promise<void>;
  } | null = null;
  let planGeneration = 0;
  const core = createRouteOwner("chat", deps.registry);
  const threadFold = core.owned("widget/thread-fold", Atom.make<PaneSide | null>(null));
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
  /** The last Work pressed on a closed document, for the tool it opened (page state, not URL). */
  const closedWork = core.owned(
    "widget/closed-work",
    Atom.make<
      (ClosedWork & { thread: string; route: string; reason: string | null; place?: string }) | null
    >(null),
  );

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    core.write(verb, atom.label?.[0] ?? "page", () =>
      deps.registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  return {
    registry: deps.registry,
    search: deps.search,
    local: deps.local ?? false,
    atoms: {
      threadFold,
      planIntent,
      planRefusal,
      closedWork,
    },
    actions: {
      /** The Place a Work press opened: its recovery band follows that Place, not a conversation. */
      placeClosedWork: (place: string) =>
        set("open-work", closedWork, (closed) => (closed ? { ...closed, place } : closed)),
      /** First Send promoted the browser draft to this host thread; the visible tool stays. */
      promoteThread: (owner: string) => {
        if (!tabs)
          return Promise.reject(Error("The workspace is not ready to promote this draft."));
        return tabs.promote(owner);
      },
      /** A Send landed in `owner`: the current Place, if a tool is visible, is its display context. */
      sent: (owner: string) => tabs?.sent(owner),
      setThreadFold: (side: PaneSide | null) => set("fold-threads", threadFold, side),
      revealThreads: () =>
        set("reveal-threads", threadFold, (side) => (side === "start" ? null : side)),
      revealChat: () => set("reveal-chat", threadFold, (side) => (side === "end" ? null : side)),
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
        keep = false,
      ) => {
        planGeneration++;
        deps.registry.set(planIntent, null);
        set("open", planRefusal, null);
        return tabs?.open(route, page, carry, false, keep) ?? Promise.resolve(false);
      },
      /**
       * The head's commit verb (K3): open the route's pane UNSCOPED (plan consumes the whole edit
       * set, so no group filter may hide part of it) and ask its Situation to run its own commit
       * once. Posts nothing to the thread; it is a route action, never a message.
       */
      planIn: (
        route: RouteKey,
        page?: LinkPage<RouteKey>,
        carry?: Pick<Carry, "target" | "work">,
      ) => {
        const generation = ++planGeneration;
        set("plan-in", planRefusal, null);
        void tabs?.open(route, page ?? {}, carry).then((opened) => {
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
      /** A Work press: that thread's tool, its Page restored when the thread holds a tab there. */
      openWork: (thread: string, route: string, resumed?: Resumed, closed?: ClosedWork) => {
        planGeneration++;
        deps.registry.set(planIntent, null);
        set(
          "open-work",
          closedWork,
          closed ? { ...closed, thread, route, reason: resumed?.reason ?? null } : null,
        );
        return tabs?.work(thread, route, resumed) ?? Promise.resolve();
      },
    },
    runAction: core.runAction,
    dispose() {
      core.dispose();
    },
  };
}

export type ChatPageStore = ReturnType<typeof createChatPageStore>;
