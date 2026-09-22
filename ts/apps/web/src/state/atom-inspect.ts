import type * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

export type OwnerReferences = Partial<
  Record<"work" | "readings" | "operations" | "page", Readonly<Record<string, Atom.Atom<unknown>>>>
>;
const inspectors = new WeakMap<AtomRegistry.AtomRegistry, ReturnType<typeof createInspector>>();
const show = (value: unknown): string => {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, child) => {
      if (typeof child === "bigint") return `${child}n`;
      if (child && typeof child === "object") {
        if (seen.has(child)) return "[Circular]";
        seen.add(child);
      }
      if (child instanceof Set) return [...child];
      if (child instanceof Map) return Object.fromEntries(child);
      return child;
    }) ?? String(value)
  );
};

function createInspector(registry: AtomRegistry.AtomRegistry) {
  const owners = new Map<
    string,
    {
      references: OwnerReferences;
      lastLocalCall: { verb: string; key: string; at: number } | null;
    }
  >();
  const listeners = new Set<() => void>();
  const ids = new WeakMap<Atom.Atom<unknown>, string>();
  let nextId = 0;
  const idOf = (atom: Atom.Atom<unknown>) => {
    let id = ids.get(atom);
    if (!id) {
      id = `${atom.label?.[0] ?? "unlabelled"}#${++nextId}`;
      ids.set(atom, id);
    }
    return id;
  };
  // Never registry.get/subscribe/mount: those can start producer effects.
  const cached = (atom: Atom.Atom<unknown>) => {
    const node = registry.getNodes().get(atom);
    const state = node?.currentState() ?? "uninitialized";
    return { state, value: state === "valid" ? show(node!.value()) : null };
  };
  const notify = () => listeners.forEach((listener) => listener());
  return {
    expose(id: string, references: OwnerReferences) {
      owners.set(id, { references, lastLocalCall: null });
      notify();
      return () => {
        owners.delete(id);
        notify();
      };
    },
    /** Notification of an actual owner publication; it makes no causal attribution. */
    notify,
    recordLocalCall(id: string, cause: { verb: string; key: string }) {
      const owner = owners.get(id);
      if (owner) owner.lastLocalCall = { ...cause, at: Date.now() };
      notify();
    },
    inspect() {
      const live = [...registry.getNodes().values()];
      return {
        census: {
          nodes: live.length,
          edges: live.reduce((n, node) => n + node.parents.length, 0),
          subscribed: live.filter((node) => node.listeners.size > 0).length,
        },
        nodes: live.map((node) => ({
          id: idOf(node.atom),
          label: node.atom.label?.[0] ?? "unlabelled",
          source: node.atom.label?.[1] ?? null,
          ...cached(node.atom),
          parents: node.parents.map((parent) => idOf(parent.atom)),
          children: node.children.map((child) => idOf(child.atom)),
        })),
        owners: [...owners].map(([id, owner]) => ({
          id,
          lastLocalCall: owner.lastLocalCall ? { ...owner.lastLocalCall } : null,
          references: Object.fromEntries(
            Object.entries(owner.references).map(([kind, entries]) => [
              kind,
              Object.fromEntries(
                Object.entries(entries).map(([name, atom]) => [
                  name,
                  { id: idOf(atom), ...cached(atom) },
                ]),
              ),
            ]),
          ),
        })),
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
      owners.clear();
    },
  };
}

export function inspectAtomRegistry(registry: AtomRegistry.AtomRegistry) {
  let inspector = inspectors.get(registry);
  if (!inspector) {
    inspector = createInspector(registry);
    inspectors.set(registry, inspector);
  }
  return inspector;
}
