import { createContext, useContext, type ReactNode } from "react";
import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { createRouteOwner, useRouteOwner } from "#/shell/owner";
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

/** Where the lens stood in a thread, for a reload in this tab. `fromUrl` is the `?turn=` it
 *  landed under: a different deep link than that one wins over the stored position. */
type StoredIntent = { intent: LensScrollIntent; fromUrl: number | null };
const intentKey = (thread: string) => `pe.lens-intent.${thread}`;

function storedIntent(thread: string, urlTurn: number | null): LensScrollIntent | undefined {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(intentKey(thread)) ?? "null",
    ) as StoredIntent | null;
    return stored?.fromUrl === urlTurn ? stored.intent : undefined;
  } catch {
    return undefined;
  }
}

function createCurrentThreadView(deps: {
  registry: AtomRegistry.AtomRegistry;
  thread: string;
  turn?: number;
}) {
  const core = createRouteOwner("chat/thread", deps.registry);
  const urlTurn = deps.turn ?? null;
  // The one call opened in the transcript (`tool:<id>`), or none.
  const openCallKey = core.owned("page/open-call-key", Atom.make<string | null>(null));
  const lensIntent = core.owned(
    "widget/lens-intent",
    Atom.make<LensScrollIntent>(
      storedIntent(deps.thread, urlTurn) ??
        (deps.turn ? { kind: "turn", turn: deps.turn } : { kind: "tail" }),
    ),
  );
  const world = core.owned<Atom.Writable<WorldState>>(
    "widget/world",
    Atom.make<WorldState>({
      density: "inspect",
      diff: false,
      open: new Set<string>(),
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
    // The URL is input; a scroll position is session state. A scroll never touches the URL: the
    // router wraps history.replaceState too, and any URL write re-renders every route subscriber.
    if (turnTimer) clearTimeout(turnTimer);
    turnTimer = setTimeout(() => {
      const stored: StoredIntent = { intent: next, fromUrl: urlTurn };
      sessionStorage.setItem(intentKey(deps.thread), JSON.stringify(stored));
    }, 250);
  };
  return {
    registry: deps.registry,
    atoms: { openCallKey, lensIntent, world, worldCache },
    actions: {
      setOpenCallKey: (value: Setter<string | null>) =>
        set("set-open-call-key", openCallKey, value),
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
  threadKey,
  registry,
  turn,
  children,
}: {
  /** Current selection identity. It resets transient view atoms without remounting persistent children. */
  threadKey: string;
  registry: AtomRegistry.AtomRegistry;
  turn?: number;
  children: ReactNode;
}) {
  const view = useRouteOwner(
    () => createCurrentThreadView({ registry, thread: threadKey, turn }),
    threadKey,
  );
  return <ThreadViewContext.Provider value={view}>{children}</ThreadViewContext.Provider>;
}

export function useCurrentThreadView(): CurrentThreadView {
  const view = useContext(ThreadViewContext);
  if (!view) throw new Error("useCurrentThreadView must be used inside CurrentThreadViewOwner.");
  return view;
}
