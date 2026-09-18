import type { ChatPluginRoute } from "./chat-plugins";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createRouteOwner } from "#/route";

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
