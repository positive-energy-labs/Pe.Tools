import { createContext, useContext, type ReactNode } from "react";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { createRouteOwner, useRouteOwner } from "#/route";
import type { LensScrollIntent } from "./model";

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

export function createCurrentThreadView(deps: {
  registry: AtomRegistry.AtomRegistry;
  turn?: number;
  patch: (partial: { turn?: number }, replace?: boolean) => Promise<void>;
}) {
  const core = createRouteOwner("chat/thread", deps.registry);
  const lensInspectKey = core.owned("page/lens-inspect-key", Atom.make<string | null>(null));
  const lensPinKey = core.owned("page/lens-pin-key", Atom.make<string | null>(null));
  const lensIntent = core.owned(
    "widget/lens-intent",
    Atom.make<LensScrollIntent>(deps.turn ? { kind: "turn", turn: deps.turn } : { kind: "tail" }),
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
  let turnTimer: ReturnType<typeof setTimeout> | undefined;
  const set = <A,>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    core.write(verb, atom.label?.[0] ?? "page", () =>
      deps.registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
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
    if (next.kind === "tail") void deps.patch({ turn: undefined }, true);
    else turnTimer = setTimeout(() => void deps.patch({ turn: next.turn }, true), 1000);
  };
  core.expose({ page: { lensInspectKey } });
  return {
    registry: deps.registry,
    atoms: { lensInspectKey, lensPinKey, lensIntent, lensFollowing, world, worldCache },
    actions: {
      setLensInspectKey: (value: Setter<string | null>) =>
        set("set-lens-inspect-key", lensInspectKey, value),
      setLensPinKey: (value: Setter<string | null>) => set("set-lens-pin-key", lensPinKey, value),
      setWorld: (value: Setter<WorldState>) => set("set-world", world, value),
      setWorldCache: (value: Setter<WorldCacheState>) => set("set-world-cache", worldCache, value),
      setLensIntent,
    },
    dispose() {
      if (turnTimer) clearTimeout(turnTimer);
      core.dispose();
    },
  };
}

export type CurrentThreadView = ReturnType<typeof createCurrentThreadView>;
const ThreadViewContext = createContext<CurrentThreadView | undefined>(undefined);

export function CurrentThreadViewOwner({
  registry,
  turn,
  patch,
  children,
}: {
  registry: AtomRegistry.AtomRegistry;
  turn?: number;
  patch: (partial: { turn?: number }, replace?: boolean) => Promise<void>;
  children: ReactNode;
}) {
  const view = useRouteOwner(() =>
    createCurrentThreadView({
      registry,
      turn,
      patch,
    }),
  );
  return <ThreadViewContext.Provider value={view}>{children}</ThreadViewContext.Provider>;
}

export function useCurrentThreadView(): CurrentThreadView {
  const view = useContext(ThreadViewContext);
  if (!view) throw new Error("useCurrentThreadView must be used inside CurrentThreadViewOwner.");
  return view;
}
