import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

export interface InspectCause {
  verb: string;
  key: string;
}

export interface InspectNode {
  id: string;
  label: string;
  source: string | null;
  state: "uninitialized" | "stale" | "valid" | "removed";
  parents: string[];
  children: string[];
  listeners: number;
  recomputes: number;
  lastChangeAt: number | null;
  value: string | null;
  writable: boolean;
}

export interface InspectChange {
  id: string;
  label: string;
  at: number;
  cause: InspectCause | null;
}

export interface InspectSnapshot {
  census: { nodes: number; edges: number; subscribed: number };
  nodes: InspectNode[];
  changes: InspectChange[];
}

export interface AtomInspector {
  note(cause: InspectCause): void;
  snapshot(): InspectSnapshot;
  subscribe(cb: () => void): () => void;
  refresh(id: string): boolean;
  set(id: string, value: string): boolean;
  dispose(): void;
}

type Node = AtomRegistry.Node<unknown>;
type Record = {
  id: string;
  value?: unknown;
  hasValue: boolean;
  recomputes: number;
  lastChangeAt: number | null;
};

const size = (value: unknown): number =>
  Array.isArray(value) ? value.length : (value as ReadonlySet<unknown>).size;

const labelOf = (node: Node) => node.atom.label?.[0] ?? "unlabelled";

const show = (value: unknown): string => {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, child) => {
        if (typeof child === "bigint") return `${child}n`;
        if (child && typeof child === "object") {
          if (seen.has(child)) return "[Circular]";
          seen.add(child);
        }
        return child;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
};

export function inspectAtomRegistry(registry: AtomRegistry.AtomRegistry): AtomInspector {
  const records = new WeakMap<Atom.Atom<unknown>, Record>();
  const nodesById = new Map<string, Node>();
  const listeners = new Set<() => void>();
  const changes: InspectChange[] = [];
  let pendingCause: InspectCause | null = null;
  let nextId = 1;
  let timer: ReturnType<typeof setInterval> | undefined;
  let current: InspectSnapshot = {
    census: { nodes: 0, edges: 0, subscribed: 0 },
    nodes: [],
    changes,
  };
  let signature = "";

  const recordFor = (node: Node) => {
    let record = records.get(node.atom);
    if (!record) {
      record = {
        id: `${labelOf(node)}#${nextId++}`,
        hasValue: false,
        recomputes: 0,
        lastChangeAt: null,
      };
      records.set(node.atom, record);
    }
    return record;
  };

  const scan = (notify = true) => {
    const liveNodes = [...registry.getNodes().values()] as Node[];
    nodesById.clear();
    for (const node of liveNodes) {
      const record = recordFor(node);
      nodesById.set(record.id, node);
      if (node.currentState() !== "valid") continue;
      const value = node.value();
      if (record.hasValue && !Object.is(record.value, value)) {
        const at = Date.now();
        record.recomputes++;
        record.lastChangeAt = at;
        changes.push({ id: record.id, label: labelOf(node), at, cause: pendingCause });
        if (changes.length > 100) changes.splice(0, changes.length - 100);
      }
      record.value = value;
      record.hasValue = true;
    }
    const nodes = liveNodes
      .map((node): InspectNode => {
        const record = recordFor(node);
        const state = node.currentState();
        return {
          id: record.id,
          label: labelOf(node),
          source: node.atom.label?.[1] ?? null,
          state,
          parents: [...node.parents].map(labelOf).sort(),
          children: [...node.children].map(labelOf).sort(),
          listeners: node.listeners.size,
          recomputes: record.recomputes,
          lastChangeAt: record.lastChangeAt,
          value: state === "valid" && record.hasValue ? show(record.value) : null,
          writable: Atom.isWritable(node.atom),
        };
      })
      .sort(
        (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
      );
    current = {
      census: {
        nodes: nodes.length,
        edges: liveNodes.reduce((total, node) => total + size(node.parents), 0),
        subscribed: liveNodes.filter((node) => node.listeners.size > 0).length,
      },
      nodes,
      changes: [...changes],
    };
    const nextSignature = JSON.stringify(current);
    if (notify && nextSignature !== signature) listeners.forEach((listener) => listener());
    signature = nextSignature;
    return current;
  };

  scan(false);

  return {
    note(cause) {
      pendingCause = { ...cause };
    },
    snapshot: () => scan(false),
    subscribe(cb) {
      listeners.add(cb);
      timer ??= setInterval(scan, 100);
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    refresh(id) {
      const node = nodesById.get(id);
      if (!node) return false;
      pendingCause = { verb: "refresh", key: labelOf(node) };
      registry.refresh(node.atom);
      scan();
      return true;
    },
    set(id, input) {
      const node = nodesById.get(id);
      if (!node || node.currentState() !== "valid" || !Atom.isWritable(node.atom)) return false;
      const value = node.value();
      const next =
        typeof value === "string"
          ? input
          : typeof value === "number"
            ? Number(input)
            : typeof value === "boolean" && (input === "true" || input === "false")
              ? input === "true"
              : undefined;
      if (next === undefined || (typeof next === "number" && !Number.isFinite(next))) return false;
      pendingCause = { verb: "set", key: labelOf(node) };
      registry.set(node.atom, next);
      scan();
      return true;
    },
    dispose() {
      if (timer) clearInterval(timer);
      listeners.clear();
    },
  };
}
