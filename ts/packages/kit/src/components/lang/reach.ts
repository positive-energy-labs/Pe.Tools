import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type FocusEvent,
  type PointerEvent,
} from "react";

export type SubjectReference = { id: number; name: string; number: number };

/** One picture's subject names, lighting and navigation. */
export type SubjectTextScope = {
  nameOf: (id: number) => string | null;
  reach?: ReachStore;
  light?: (
    references: readonly SubjectReference[],
    focus: number | null,
    owner?: string,
    ids?: readonly number[],
  ) => void;
  clear?: (owner: string) => void;
  /** Defer clearing while the pointer travels over the picture. */
  hold?: () => void;
  go?: (id: number) => void;
  refProps?: (id: number) => Record<string, string | undefined>;
};
export const SubjectTextContext = createContext<SubjectTextScope | null>(null);

export const REACH_RUNGS = ["rest", "reach", "hover", "focus"] as const;
export type ReachRung = (typeof REACH_RUNGS)[number];

export type SubjectLighting = {
  ids: ReadonlySet<number>;
  references: readonly SubjectReference[];
  focus: number | null;
  owner?: string;
};
export const NO_LIGHTING: SubjectLighting = { ids: new Set(), references: [], focus: null };

/** Shared pointer and subject lighting; only subscribers to a changed mark re-render. */
export type Reach = {
  lighting: SubjectLighting;
  hovered: number | null;
  issue: string | null;
};
export function reachStore() {
  let state: Reach = { lighting: NO_LIGHTING, hovered: null, issue: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    /** `next` returns the same state to change nothing (no listener runs). */
    set(next: (state: Reach) => Reach) {
      const value = next(state);
      if (value === state) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
export type ReachStore = ReturnType<typeof reachStore>;
const IDLE = reachStore();
/** One slice of the reach state; `pick` must return a stable value (a field or a primitive). */
export function useReachState<T>(
  store: ReachStore | null | undefined,
  pick: (state: Reach) => T,
): T {
  const s = store ?? IDLE;
  return useSyncExternalStore(s.subscribe, () => pick(s.get()));
}

/** One scoped channel for list rows, SVG marks, and the scene adapter. */
export function useReach(id?: number): ReachRung {
  return useReachState(useContext(SubjectTextContext)?.reach, (state) =>
    id == null
      ? "rest"
      : state.lighting.focus === id
        ? "focus"
        : state.hovered === id
          ? "hover"
          : state.lighting.ids.has(id)
            ? "reach"
            : "rest",
  );
}
export function useReachSetter() {
  const store = useContext(SubjectTextContext)?.reach;
  return useCallback(
    (hovered: number | null) =>
      store?.set((state) => (state.hovered === hovered ? state : { ...state, hovered })),
    [store],
  );
}

/** Physical contact advances the same ladder without putting pointer motion in React state. */
export function reachProps(rung: ReachRung = "rest") {
  const paint = (el: Element, over: boolean, focused = el.matches(":focus-within")) =>
    el.setAttribute("data-reach", focused ? "focus" : over ? "hover" : rung);
  return {
    "data-reach": rung,
    onPointerOver: (event: PointerEvent<Element>) => paint(event.currentTarget, true),
    onPointerOut: (event: PointerEvent<Element>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
        paint(event.currentTarget, false);
    },
    onFocus: (event: FocusEvent<Element>) => paint(event.currentTarget, false, true),
    onBlur: (event: FocusEvent<Element>) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        paint(event.currentTarget, event.currentTarget.matches(":hover"), false);
    },
  };
}
