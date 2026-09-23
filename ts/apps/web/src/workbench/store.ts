import type { ChatPluginRoute } from "./chat-plugins";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createRouteOwner } from "#/route/route-owner";

export interface ChatSearch {
  readonly thread?: string;
  readonly mode: string;
  readonly turn?: number;
  readonly plugin?: ChatPluginRoute;
  readonly focus?: string;
  readonly prompt?: string;
  patch(partial: Partial<Omit<ChatSearch, "patch">>, replace?: boolean): Promise<void>;
}

type Setter<A> = A | ((previous: A) => A);

export function createChatPageStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  search: ChatSearch;
}) {
  const core = createRouteOwner("chat", deps.registry);
  const paletteOpen = core.owned("widget/palette-open", Atom.make(false));
  const expandedPane = core.owned(
    "widget/expanded-pane",
    Atom.make<"side" | "plugin" | null>(deps.search.plugin ? "plugin" : "side"),
  );
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
  const pluginOpen = Atom.map(expandedPane, (pane) => pane === "plugin");

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    core.write(verb, atom.label?.[0] ?? "page", () =>
      deps.registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const setPaneOpen = (pane: "side" | "plugin", value: Setter<boolean>) =>
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
      pluginOpen,
      planIntent,
      planRefusal,
    },
    actions: {
      setPaletteOpen: (value: Setter<boolean>) => set("set-palette", paletteOpen, value),
      setSideOpen: (value: Setter<boolean>) => setPaneOpen("side", value),
      setPluginOpen: (value: Setter<boolean>) => setPaneOpen("plugin", value),
      setMode: (mode: string) => void deps.search.patch({ mode }),
      /**
       * The one way into the plugin pane (head plan, `open ›`, the close button). It patches only
       * the Chat URL, never navigates, posts nothing to the thread, and sets the focus the head's
       * group drill-in names; every other entry opens the pane unscoped.
       */
      setPlugin: (plugin?: ChatPluginRoute, focus?: readonly string[]) =>
        void deps.search.patch({
          plugin,
          focus: plugin && focus ? JSON.stringify(focus) : undefined,
        }),
      /**
       * The head's commit verb (K3): open the route's pane UNSCOPED (plan consumes the whole staged
       * set, so no group filter may hide part of it) and ask its Situation to run its own commit
       * once. Posts nothing to the thread; it is a route action, never a message.
       */
      planIn: (plugin: ChatPluginRoute) => {
        set("plan-in", planIntent, { route: plugin, nonce: Date.now() });
        set("plan-in", planRefusal, null);
        void deps.search.patch({ plugin, focus: undefined });
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
