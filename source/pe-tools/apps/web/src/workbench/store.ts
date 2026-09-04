import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createRouteStoreCore } from "#/state/route-store";

export interface WorkbenchAttachment {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
}

export interface ChatSearch {
  readonly thread?: string;
  readonly mode: string;
  readonly turn?: number;
  readonly plugin?:
    | "family"
    | "families"
    | "settings"
    | "parameter-links"
    | "schedule-grid"
    | "instances";
  readonly prompt?: string;
  patch(partial: Partial<Omit<ChatSearch, "patch">>, replace?: boolean): Promise<void>;
}

type Setter<A> = A | ((previous: A) => A);
type WorldState = {
  density: "inspect" | "plain";
  diff: boolean;
  open: Set<string>;
  openItems: Set<string>;
};
type WorldCacheState = {
  lastTurn: number | null;
  prevSig: Map<string, string>;
  baseline: Map<string, string> | null;
};

export function createChatPageStore(deps: {
  registry: AtomRegistry.AtomRegistry;
  search: ChatSearch;
}) {
  const core = createRouteStoreCore("chat", deps.registry);
  const paletteOpen = core.owned("page/palette-open", Atom.make(false));
  const sideOpen = core.owned("page/side-open", Atom.make(true));
  const pluginOpen = core.owned("page/plugin-open", Atom.make(Boolean(deps.search.plugin)));
  const lensInspectKey = core.owned("page/lens-inspect-key", Atom.make<string | null>(null));
  const lensFollowing = core.owned("page/lens-following", Atom.make(!deps.search.turn));
  const world = core.owned<Atom.Writable<WorldState>>(
    "page/world",
    Atom.make<WorldState>({
      density: "inspect",
      diff: false,
      open: new Set(["system-prompt"]),
      openItems: new Set<string>(),
    }),
  );
  const worldCache = core.owned(
    "page/world-cache",
    Atom.make<WorldCacheState>({ lastTurn: null, prevSig: new Map(), baseline: null }),
  );
  const draft = core.owned(
    "page/composer",
    Atom.make<{ text: string; attachments: WorkbenchAttachment[] }>({
      text: deps.search.prompt ?? "",
      attachments: [],
    }),
  );
  let promptTimer: ReturnType<typeof setTimeout> | undefined;
  let turnTimer: ReturnType<typeof setTimeout> | undefined;

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    core.write(verb, atom.label?.[0] ?? "page", () =>
      deps.registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const setDraft = (next: Setter<{ text: string; attachments: WorkbenchAttachment[] }>) => {
    set("set-draft", draft, next);
    if (promptTimer) clearTimeout(promptTimer);
    const value = deps.registry.get(draft);
    const prompt = value.text.trim();
    if (!prompt || prompt.length > 200 || value.attachments.length) {
      void deps.search.patch({ prompt: undefined }, true);
      return;
    }
    promptTimer = setTimeout(() => void deps.search.patch({ prompt }, true), 300);
  };
  const setTurn = (turn?: number) => {
    if (turnTimer) clearTimeout(turnTimer);
    turnTimer = setTimeout(() => void deps.search.patch({ turn }, true), 1000);
  };

  return {
    registry: deps.registry,
    search: deps.search,
    atoms: {
      paletteOpen,
      sideOpen,
      pluginOpen,
      lensInspectKey,
      lensFollowing,
      world,
      worldCache,
      draft,
      ...core.verbAtoms,
    },
    actions: {
      setPaletteOpen: (value: Setter<boolean>) => set("set-palette", paletteOpen, value),
      setSideOpen: (value: Setter<boolean>) => set("set-side", sideOpen, value),
      setPluginOpen: (value: Setter<boolean>) => set("set-plugin", pluginOpen, value),
      setLensInspectKey: (value: Setter<string | null>) =>
        set("set-lens-inspect-key", lensInspectKey, value),
      setLensFollowing: (value: Setter<boolean>) => set("set-lens-following", lensFollowing, value),
      setWorld: (value: Setter<WorldState>) => set("set-world", world, value),
      setWorldCache: (value: Setter<WorldCacheState>) => set("set-world-cache", worldCache, value),
      setDraft,
      setMode: (mode: string) => void deps.search.patch({ mode }),
      setTurn,
      setPlugin: (plugin?: ChatSearch["plugin"]) => void deps.search.patch({ plugin }),
      openThread: (thread: string, replace = false) => deps.search.patch({ thread }, replace),
    },
    runVerb: core.runVerb,
    dispose() {
      if (promptTimer) clearTimeout(promptTimer);
      if (turnTimer) clearTimeout(turnTimer);
      core.dispose();
    },
  };
}

export type ChatPageStore = ReturnType<typeof createChatPageStore>;
