import type { ChatPluginRoute } from "./chat-plugins";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createRouteOwner } from "#/route/route-owner";
import type { ClosedWork, Resumed } from "#/chat/thread-work";
import {
  THREAD_TABS_MAX,
  threadTabSchema,
  type ThreadTab,
  type RouteKey,
  type LinkPage,
  type Carry,
} from "@pe/agent-contracts";

/** Local issuance is a draft, or the host thread it was promoted to; never host metadata. */
export function routeThreadIssue(thread: string, state: unknown): string | null {
  if (!thread) return null;
  try {
    const issued = sessionStorage.getItem(`pe.routeThread.${thread}`);
    if (issued) return issued;
  } catch {
    /* History still identifies the current draft. */
  }
  return (state as { __peMintedThread?: string } | null)?.__peMintedThread === thread
    ? "minted"
    : null;
}

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
    promote: (from: string, owner: string, current: () => boolean) => Promise<void>;
    open: <R extends RouteKey>(
      route: R,
      page?: LinkPage<R>,
      carry?: Pick<Carry, "target" | "work">,
      duplicate?: boolean,
      keep?: boolean,
    ) => Promise<boolean>;
    work: (thread: string, route: string, resumed?: Resumed) => Promise<void>;
  } | null = null;
  const drafts = new Map<string, ThreadTab[]>();
  const draftTabs = (thread: string) => {
    if (!drafts.has(thread)) {
      let saved: ThreadTab[] = [];
      try {
        saved =
          threadTabSchema
            .array()
            .max(THREAD_TABS_MAX)
            .safeParse(JSON.parse(sessionStorage.getItem(`pe.draftTabs.${thread}`) ?? "[]")).data ??
          [];
      } catch {
        /* An unavailable browser cache does not invent a saved Place. */
      }
      drafts.set(thread, saved);
    }
    return drafts.get(thread)!;
  };
  let planGeneration = 0;
  const core = createRouteOwner("chat", deps.registry);
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
  /** The last Work pressed on a closed document, for the tool it opened (page state, not URL). */
  const closedWork = core.owned(
    "widget/closed-work",
    Atom.make<(ClosedWork & { thread: string; route: string; reason: string | null }) | null>(null),
  );

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
    local: deps.local ?? false,
    atoms: {
      sideOpen,
      planIntent,
      planRefusal,
      closedWork,
    },
    actions: {
      draftTabs,
      saveDraftTabs: (thread: string, next: ThreadTab[]) => {
        drafts.set(thread, next);
        try {
          sessionStorage.setItem(`pe.draftTabs.${thread}`, JSON.stringify(next));
        } catch {
          /* Keep this mounted draft. */
        }
      },
      promoteThread: (from: string, owner: string, current: () => boolean) => {
        if (!tabs)
          return Promise.reject(Error("The workspace is not ready to promote this draft."));
        return tabs.promote(from, owner, current);
      },
      finishDraft: (from: string, owner: string) => {
        drafts.delete(from);
        if (!from) return;
        try {
          sessionStorage.setItem(`pe.routeThread.${from}`, owner);
          sessionStorage.removeItem(`pe.draftTabs.${from}`);
        } catch {
          /* The replaced URL still names the confirmed owner. */
        }
      },
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
        keep = false,
      ) => {
        planGeneration++;
        deps.registry.set(planIntent, null);
        set("open", planRefusal, null);
        return tabs?.open(route, page, carry, false, keep) ?? Promise.resolve(false);
      },
      /**
       * The head's commit verb (K3): open the route's pane UNSCOPED (plan consumes the whole staged
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
