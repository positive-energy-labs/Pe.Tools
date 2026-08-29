import { useSyncExternalStore } from "react";

import type { ZoneRecord } from "../world";

export type StagedItem = {
  key: string;
  zone: string;
  level: string;
  runA: string | null;
  runB: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  flags: string[];
  note: string;
  stagedAt: number;
};

export type ExportRecord = {
  verb: "chat" | "sheet" | "snip";
  dir: string;
  stamp: string;
  files: string[];
  manifestPath: string;
  setUrl: string;
  text: string;
  copiedVia: "os" | "browser" | null;
  opened: string | null;
  warning: string | null;
  atUtc: string;
};

type FbState = {
  items: StagedItem[];
  hoverFlag: string | null;
  loadedSet: string | null;
  exporting: ExportRecord["verb"] | null;
  lastExport: ExportRecord | null;
  exportError: string | null;
};

export function itemKey(zone: string, runA: string | null, runB: string): string {
  return `${zone}::${runA ?? "-"}::${runB}`;
}

type Store = { state: FbState; listeners: Set<() => void> };

const g = globalThis as { __peRunsFeedback?: Store };
const store: Store = (g.__peRunsFeedback ??= {
  state: {
    items: [],
    hoverFlag: null,
    loadedSet: null,
    exporting: null,
    lastExport: null,
    exportError: null,
  },
  listeners: new Set(),
});

function emit(next: Partial<FbState>) {
  store.state = { ...store.state, ...next };
  for (const l of store.listeners) l();
}

function subscribe(l: () => void): () => void {
  store.listeners.add(l);
  return () => store.listeners.delete(l);
}

export function useFb(): FbState {
  return useSyncExternalStore(
    subscribe,
    () => store.state,
    () => store.state,
  );
}

export const fb = {
  get: () => store.state,

  toggleStage(item: Omit<StagedItem, "flags" | "note" | "stagedAt">) {
    const existing = store.state.items.find((i) => i.key === item.key);
    emit({
      items: existing
        ? store.state.items.filter((i) => i.key !== item.key)
        : [...store.state.items, { ...item, flags: [], note: "", stagedAt: Date.now() }],
    });
  },

  unstage(key: string) {
    emit({ items: store.state.items.filter((i) => i.key !== key) });
  },

  clear() {
    emit({ items: [], loadedSet: null });
  },

  replaceAll(items: StagedItem[], loadedSet: string | null) {
    emit({ items, loadedSet });
  },

  toggleFlag(key: string, el: string) {
    emit({
      items: store.state.items.map((i) =>
        i.key === key
          ? {
              ...i,
              flags: i.flags.includes(el) ? i.flags.filter((f) => f !== el) : [...i.flags, el],
            }
          : i,
      ),
    });
  },

  setHoverFlag(hoverFlag: string | null) {
    if (store.state.hoverFlag !== hoverFlag) emit({ hoverFlag });
  },

  setNote(key: string, note: string) {
    emit({ items: store.state.items.map((i) => (i.key === key ? { ...i, note } : i)) });
  },

  exportStarted(verb: ExportRecord["verb"]) {
    emit({ exporting: verb, exportError: null });
  },

  exportDone(rec: ExportRecord) {
    emit({ exporting: null, lastExport: rec, exportError: null });
  },

  exportFailed(message: string) {
    emit({ exporting: null, exportError: message });
  },
};

export function flagLabel(el: string): string {
  const [kind, id] = el.split(":");
  return `${kind} ${id}`;
}
