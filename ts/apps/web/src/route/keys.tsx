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
import { createContext, use, useMemo, useRef, type ReactNode, type RefObject } from "react";
import {
  useHotkeys,
  useHotkeyRegistrations,
  type UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";

import type { RouteHandle } from "./use-route";

/** The help page reads every binding back through this; nothing keeps a second list of keys. */
export { useHotkeyRegistrations };

/** A chord, in the library's template-string grammar (`Mod+Enter`, `Escape`, `R`). */
export type Chord = UseHotkeyDefinition["hotkey"];

/** What `options.meta` carries on every registration. */
export interface KeyMeta {
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
  options?: UseHotkeyDefinition["options"];
}

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
  const definitions: UseHotkeyDefinition[] = keys.map((key) => ({
    hotkey: key.hotkey,
    callback: key.callback,
    options: {
      ignoreInputs: true,
      ...key.options,
      enabled: node.live && key.options?.enabled !== false,
      meta: {
        name: key.label,
        description: key.says ?? key.label,
        scope: node.id,
        depth: node.depth,
        refusal: key.refusal ?? null,
      } satisfies KeyMeta,
    },
  }));
  useHotkeys(definitions, { target: region ?? node.element });
}

/* ── The route node ────────────────────────────────────────────────────────── */

/**
 * The route scope: the outermost node, bound on the document so a route chord fires with nothing
 * focused. It binds every manifest action that declares a chord; a refused chord still fires and
 * the handle records the refusal, exactly like a refused button.
 */
export function RouteKeys<W, R extends string, P, A extends string>({
  handle,
  chords = true,
  children,
}: {
  handle: RouteHandle<W, R, P, A>;
  /** False where another route already owns the chords (this page is embedded in a chat pane). */
  chords?: boolean;
  children?: ReactNode;
}) {
  const latest = useRef(handle);
  latest.current = handle;
  const names = chords
    ? (Object.keys(handle.actions) as A[]).filter(
        (name) => handle.actions[name].chord !== undefined,
      )
    : [];
  return (
    <KeyScope id={handle.manifest.name}>
      <NodeChords
        keys={names.map((name) => {
          const action = handle.actions[name];
          return {
            hotkey: action.chord as Chord,
            label: action.label,
            says: action.says,
            refusal: action.refusal,
            callback: () => void latest.current.actions[name].run(),
          };
        })}
      />
      {children}
    </KeyScope>
  );
}

/** Inside the node it declares, so `useScopeKeys` reads that node and not the one above it. */
function NodeChords({ keys }: { keys: readonly ScopeKey[] }) {
  useScopeKeys(keys);
  return null;
}

/* ── The stage node ────────────────────────────────────────────────────────── */

/**
 * The stage scope: the rung between the route and its panes. A stage owns its chords — the stage
 * declares them (`route/stage.ts`, `StageDecl.keys`) and the manifest carries none — so a chord
 * bound in one stage is dead the moment another stage draws. Like the route node it binds on the
 * document, so a stage chord fires with nothing focused, and a pane's own chord still wins over it.
 */
export function StageKeys<W, R extends string, P, A extends string>({
  id,
  handle,
  keys,
  chords = true,
  children,
}: {
  /** What help hangs these keys off: `${route}:${stage}`. */
  id: string;
  handle: RouteHandle<W, R, P, A>;
  keys: Partial<Readonly<Record<A, Chord>>>;
  /** False where another surface owns the chords (this page is embedded in a chat pane). */
  chords?: boolean;
  children?: ReactNode;
}) {
  const latest = useRef(handle);
  latest.current = handle;
  return (
    <KeyScope id={id} hidden={!chords}>
      <NodeChords
        keys={(Object.entries(keys) as [A, Chord][]).map(([name, hotkey]) => {
          const action = handle.actions[name];
          return {
            hotkey,
            label: action.label,
            says: action.says,
            refusal: action.refusal,
            callback: () => void latest.current.actions[name].run(),
          };
        })}
      />
      {children}
    </KeyScope>
  );
}
