import type { ChatPluginRoute } from "./route-chat-plugins";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { createRouteOwner } from "#/route";
import type { LensScrollIntent } from "./model";

export interface WorkbenchAttachment {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
}

interface ChatDraft {
  text: string;
  attachments: WorkbenchAttachment[];
}

export interface ChatSearch {
  readonly thread?: string;
  readonly mode: string;
  readonly turn?: number;
  readonly plugin?: ChatPluginRoute;
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
  const core = createRouteOwner("chat", deps.registry);
  const paletteOpen = core.owned("widget/palette-open", Atom.make(false));
  const expandedPane = core.owned(
    "widget/expanded-pane",
    Atom.make<"side" | "plugin" | null>(deps.search.plugin ? "plugin" : "side"),
  );
  const sideOpen = Atom.map(expandedPane, (pane) => pane === "side");
  const pluginOpen = Atom.map(expandedPane, (pane) => pane === "plugin");
  const lensInspectKey = core.owned("page/lens-inspect-key", Atom.make<string | null>(null));
  // A pinned tool outranks hover and focal in the trace lane's inspect window, so an inspection
  // survives the pointer leaving (and survives scrolling the transcript).
  const lensPinKey = core.owned("page/lens-pin-key", Atom.make<string | null>(null));
  // The one owner of where the transcript should sit: the tail (following) or a turn the user
  // scrolled to. Follow state and the URL `turn` are derived from it, never written beside it.
  const lensIntent = core.owned(
    "widget/lens-intent",
    Atom.make<LensScrollIntent>(
      deps.search.turn ? { kind: "turn", turn: deps.search.turn } : { kind: "tail" },
    ),
  );
  const lensFollowing = Atom.map(lensIntent, (intent) => intent.kind === "tail");
  const world = core.owned<Atom.Writable<WorldState>>(
    "widget/world",
    Atom.make<WorldState>({
      density: "inspect",
      diff: false,
      open: new Set(["system-prompt"]),
      openItems: new Set<string>(),
    }),
  );
  const worldCache = core.owned(
    "widget/world-cache",
    Atom.make<WorldCacheState>({ lastTurn: null, prevSig: new Map(), baseline: null }),
  );
  const draft = core.owned(
    "page/composer",
    Atom.make<ChatDraft>({
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
  const setDraft = (next: Setter<ChatDraft>) => {
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
  const setPaneOpen = (pane: "side" | "plugin", value: Setter<boolean>) =>
    set(`set-${pane}`, expandedPane, (previous) => {
      const open = typeof value === "function" ? value(previous === pane) : value;
      return open ? pane : previous === pane ? null : previous;
    });
  const setLensIntent = (next: LensScrollIntent) => {
    const previous = deps.registry.get(lensIntent);
    if (
      next.kind === "tail"
        ? previous.kind === "tail"
        : previous.kind === "turn" && previous.turn === next.turn
    )
      return;
    set("set-lens-intent", lensIntent, next);
    if (turnTimer) clearTimeout(turnTimer);
    // Back at the tail: clear the URL turn now, so a reload does not reopen a stale position.
    if (next.kind === "tail") void deps.search.patch({ turn: undefined }, true);
    else turnTimer = setTimeout(() => void deps.search.patch({ turn: next.turn }, true), 1000);
  };

  core.expose({
    page: {
      lensInspectKey,
      draft,
    },
  });
  return {
    registry: deps.registry,
    search: deps.search,
    atoms: {
      paletteOpen,
      sideOpen,
      pluginOpen,
      lensInspectKey,
      lensPinKey,
      lensIntent,
      lensFollowing,
      world,
      worldCache,
      draft,
    },
    actions: {
      setPaletteOpen: (value: Setter<boolean>) => set("set-palette", paletteOpen, value),
      setSideOpen: (value: Setter<boolean>) => setPaneOpen("side", value),
      setPluginOpen: (value: Setter<boolean>) => setPaneOpen("plugin", value),
      setLensInspectKey: (value: Setter<string | null>) =>
        set("set-lens-inspect-key", lensInspectKey, value),
      setLensPinKey: (value: Setter<string | null>) => set("set-lens-pin-key", lensPinKey, value),
      setWorld: (value: Setter<WorldState>) => set("set-world", world, value),
      setWorldCache: (value: Setter<WorldCacheState>) => set("set-world-cache", worldCache, value),
      setDraft,
      clearDraftIfUnchanged: (sent: ChatDraft) => {
        if (deps.registry.get(draft) === sent) setDraft({ text: "", attachments: [] });
      },
      setMode: (mode: string) => void deps.search.patch({ mode }),
      setLensIntent,
      setPlugin: (plugin?: ChatSearch["plugin"]) => void deps.search.patch({ plugin }),
      openThread: (thread: string, replace = false) => deps.search.patch({ thread }, replace),
    },
    runAction: core.runAction,
    dispose() {
      if (promptTimer) clearTimeout(promptTimer);
      if (turnTimer) clearTimeout(turnTimer);
      core.dispose();
    },
  };
}

export type ChatPageStore = ReturnType<typeof createChatPageStore>;
