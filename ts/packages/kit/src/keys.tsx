/**
 * THE SCOPE TREE — the one place a chord is bound (ledger 2026-09-22).
 *
 * A scope node is a route, an optional stage, a pane, or a nested region a pane declares. Nodes
 * nest: `KeyScope` reads the node above it from context and publishes itself to the tree below.
 * A node is LIVE when it is not hidden and no node above it is hidden. Focus decides which live
 * node is innermost: a node registers its keys on its own element, so the browser only routes a
 * key to it when focus is inside that element, and the library's `stopPropagation` default means
 * the innermost live binding wins and the ones above it never see the event. The route node has
 * no element — it binds on the document, so a route chord still fires with nothing focused.
 *
 * `useScopeKeys` is the only door. A file that imports `@tanstack/react-hotkeys` to register a
 * chord is a repo-guard red (`tests/repo-guards/src/route-primitive.guard.test.ts`).
 */
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  formatForDisplay,
  getHotkeyManager,
  toHotkeyRegistrationView,
  useHotkeys,
  type UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";

/**
 * The help page reads every binding back through this; nothing keeps a second list of keys. It is a
 * snapshot, not a subscription: the library's hook re-renders its reader on every registration, and
 * a registration made while another component renders then sets state mid-render.
 */
export const readRegistrations = () =>
  Array.from(getHotkeyManager().registrations.state.values()).map(toHotkeyRegistrationView);
/** A chord as this platform spells it (Ctrl+K on Windows, ⌘ K on macOS); `Kbd` prints it. */
export { formatForDisplay as chordLabel };

/** A chord, in the library's template-string grammar (`Mod+Enter`, `Escape`, `R`). */
export type Chord = UseHotkeyDefinition["hotkey"];

/** What `options.meta` carries on every registration. */
export interface KeyMeta {
  actionId?: string;
  name: string;
  description: string;
  /** The scope node that bound it: its id, and its depth in the tree (0 = the route). */
  scope: string;
  depth: number;
  /** The sentence the chord would refuse with right now; null when it runs. */
  refusal: string | null;
}

/** The registration view's meta, or nothing for a chord bound without one (a library default). */
export const readKeyMeta = (meta: unknown): KeyMeta | null =>
  meta && typeof meta === "object" && "scope" in meta ? (meta as KeyMeta) : null;

/* ── The tree ──────────────────────────────────────────────────────────────── */

interface ScopeNode {
  id: string;
  depth: number;
  /** Not hidden, and nothing above it hidden. A node that is not live binds nothing. */
  live: boolean;
  /** The element focus must be inside; absent = the document (the route node). */
  element?: RefObject<HTMLElement | null>;
}

/**
 * The tree's root, and the context's default: every node nests under it, so a surface rendered
 * alone (a test, a popover) still has a live node to hang off, and nothing declares it twice.
 */
const APP: ScopeNode = { id: "app", depth: 0, live: true };

const ScopeContext = createContext<ScopeNode>(APP);

export function KeyScope({
  id,
  element,
  hidden = false,
  children,
}: {
  /** What help hangs these keys off; a pane node uses the pane's id. */
  id: string;
  element?: RefObject<HTMLElement | null>;
  /** A hidden pane stays mounted under `<Activity mode="hidden">`; its node is inactive. */
  hidden?: boolean;
  children: ReactNode;
}) {
  const above = use(ScopeContext);
  const live = !hidden && above.live;
  const depth = above.depth + 1;
  const node = useMemo(() => ({ id, depth, live, element }), [id, depth, live, element]);
  return <ScopeContext value={node}>{children}</ScopeContext>;
}

/** Whether the innermost scope node is live: a key `available` reads it so a hidden pane binds nothing. */
export const useScopeLive = (): boolean => use(ScopeContext).live;

/** One chord a scope node binds. */
export interface ScopeKey {
  hotkey: Chord;
  callback: UseHotkeyDefinition["callback"];
  /** The chord's name in help and on the pane's key card. */
  label: string;
  /** One sentence for help; defaults to the label. */
  says?: string;
  /** The sentence it refuses with right now; the key still fires, so the surface can speak. */
  refusal?: string | null;
  /** Stable action identity; surfaces that invoke this chord use the same definition. */
  actionId?: string;
  /** Omit this registration when the action is not available in the current render. */
  available?: () => boolean;
  options?: UseHotkeyDefinition["options"];
}

/** One action definition can feed a menu/button and its scoped keyboard bindings. */
export interface ActionDefinition {
  id: string;
  label: string;
  description?: string;
  bindings?: readonly Chord[];
  available?: () => boolean;
  refusal?: string | null;
  invoke: (event?: KeyboardEvent) => boolean | void;
  options?: UseHotkeyDefinition["options"];
}

/** The single admission gate used by every surface that invokes an action. */
export const invokeAction = (action: ActionDefinition, event?: KeyboardEvent): boolean => {
  if (action.available?.() === false || action.refusal != null) return false;
  return action.invoke(event) !== false;
};

/** Adapt action definitions into the existing scope tree; this is not a second registry. */
export const actionScopeKeys = (actions: readonly ActionDefinition[]): ScopeKey[] =>
  actions.flatMap((action) =>
    (action.bindings ?? []).map((hotkey) => ({
      actionId: action.id,
      hotkey,
      callback: (event) => {
        if (invokeAction(action, event)) event.preventDefault();
      },
      label: action.label,
      says: action.description,
      available: action.available,
      refusal: action.refusal,
      options: { preventDefault: false, ...action.options },
    })),
  );

const UNMOUNTED: RefObject<HTMLElement | null> = { current: null };

/**
 * Bind chords on the innermost scope node — the only door to a hotkey registration in this app.
 *
 * `region` narrows one binding to an element inside the node (a cell, a list, a canvas) without
 * declaring a node of its own: focus must be in that element, and the key still reads as the
 * node's in help. It is the "nested region a pane declares" rung of the tree.
 */
export function useScopeKeys(
  keys: readonly ScopeKey[],
  region?: RefObject<HTMLElement | null> | HTMLElement | null,
): void {
  const node = use(ScopeContext);
  const definitions: UseHotkeyDefinition[] = (region === null ? [] : keys)
    .filter((key) => key.available?.() !== false)
    .map((key) => ({
      hotkey: key.hotkey,
      callback: key.callback,
      options: {
        ignoreInputs: true,
        ...key.options,
        enabled: node.live && key.options?.enabled !== false,
        meta: {
          name: key.label,
          actionId: key.actionId,
          description: key.says ?? key.label,
          scope: node.id,
          depth: node.depth,
          refusal: key.refusal ?? null,
        } satisfies KeyMeta,
      },
    }));
  // A `null` region is one not mounted yet: it binds nothing, never the node's element instead.
  useHotkeys(definitions, { target: region === null ? UNMOUNTED : (region ?? node.element) });
}

/* ── Gestures ──────────────────────────────────────────────────────────────── */

/** A pointer action, as help spells it. A chord is never one of these: chords are `ScopeKey`s. */
export type PointerKind =
  | "drag"
  | "right-drag"
  | "wheel"
  | "pinch"
  | "scroll"
  | "click"
  | "double-click"
  | "hover";

/**
 * One thing a pane answers that is not a bound chord: a pointer gesture, held keys with one
 * (`keys: ["Shift"], pointer: "drag"`), or keys a native widget already handles (a tree's arrows,
 * a field's Enter). It is documentation of behaviour, never a binding; the surface that handles it
 * owns the behaviour and declares it here so the help page draws it on the pane's card.
 */
export interface ScopeGesture {
  pointer?: PointerKind;
  /** Keys held with the pointer, or pressed alone when there is no pointer ("↑", "Enter"). */
  keys?: readonly string[];
  label: string;
  says?: string;
}

/** A declared gesture with the scope node that declared it, as the help page joins it to a pane. */
export interface DeclaredGesture extends ScopeGesture {
  scope: string;
  depth: number;
  host?: HTMLElement | null;
}

const declared = new Map<symbol, readonly DeclaredGesture[]>();
const gestureListeners = new Set<() => void>();
let gestureSnapshot: DeclaredGesture[] = [];
const gesturesChanged = () => {
  gestureSnapshot = [...declared.values()].flat();
  gestureListeners.forEach((notify) => notify());
};
const subscribeGestures = (notify: () => void) => {
  gestureListeners.add(notify);
  return () => {
    gestureListeners.delete(notify);
  };
};
export const useDeclaredGestures = () =>
  useSyncExternalStore(
    subscribeGestures,
    () => gestureSnapshot,
    () => gestureSnapshot,
  );

/** Every gesture declared by a live scope node now; a snapshot, like `readRegistrations`. */
export const readGestures = (): DeclaredGesture[] => [...declared.values()].flat();

/** Declare gestures on the innermost scope node; a hidden node declares none. */
export function useScopeGestures(
  gestures: readonly ScopeGesture[],
  host?: HTMLElement | null,
): void {
  const node = use(ScopeContext);
  const spelled = JSON.stringify(gestures);
  useEffect(() => {
    if (!node.live) return;
    const id = Symbol(node.id);
    declared.set(
      id,
      (JSON.parse(spelled) as ScopeGesture[]).map((g) => ({
        ...g,
        scope: node.id,
        depth: node.depth,
        host: host === undefined ? node.element?.current : host,
      })),
    );
    gesturesChanged();
    return () => {
      declared.delete(id);
      gesturesChanged();
    };
  }, [node.id, node.depth, node.live, node.element, spelled, host]);
}

export function ScopeGestures({ gestures }: { gestures: readonly ScopeGesture[] }) {
  useScopeGestures(gestures);
  return null;
}

/* ── The route and stage nodes ─────────────────────────────────────────────── */

/**
 * A route or stage scope node: it binds on the document, so its chords fire with nothing focused,
 * and a pane's own chord still wins over it. A refused chord still fires and the handle records
 * the refusal, exactly like a refused button.
 */
export function KeysNode({
  id,
  keys,
  hidden,
  children,
}: {
  /** What help hangs these keys off: the route name, or `${route}:${stage}`. */
  id: string;
  keys: readonly ScopeKey[];
  /** False-owner gate: a stage embedded where another surface owns the chords (a chat pane). */
  hidden?: boolean;
  children?: ReactNode;
}) {
  return (
    <KeyScope id={id} hidden={hidden}>
      <ScopeKeys keys={keys} />
      {children}
    </KeyScope>
  );
}

/** Bind chords on the enclosing scope node from inside its tree (a pane body). */
export function ScopeKeys({ keys }: { keys: readonly ScopeKey[] }) {
  useScopeKeys(keys);
  return null;
}
