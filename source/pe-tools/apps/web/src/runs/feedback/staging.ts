// The /runs feedback staging store — which zone A/B cards are staged for export, which
// elements are flagged, and the one note per staged item. Promoted at feedback round 2
// (kaitpw rulings 2026-08-17): the ?fb= variants died, staging is part of the one surface.
//
// STATE MODEL (round-2 ruling, verbatim law):
// - A staged item PINS (zone, runA, runB, flags, note) at stage time. The page A/B selector is
//   a viewing LENS only — switching it never alters the stage. Multi-run stage sets are normal.
// - Persistence is the EXPORT MANIFEST, nothing else. In-memory here; ?set=<stamp> rehydrates
//   (editable) from _exports/<stamp>/manifest.json; re-export mints a NEW stamp.
//
// Still an external store (useSyncExternalStore), but the singleton lives on globalThis so a
// vite hot-swap re-instantiating this module reuses the same state (round-1 friction #5: the
// plain module singleton split across HMR and exports lost their status line).
import { useSyncExternalStore } from "react";

import type { ZoneRecord } from "../world";

/** A staged A/B card, snapshotted at stage time. If the user swings the lens to another run
 * pair the staged item keeps the pair it was staged FROM — a verdict is about a specific
 * comparison. */
export type StagedItem = {
  key: string;
  zone: string;
  level: string;
  runA: string | null;
  runB: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  /** Flagged element ids — DATA, not pixels: "room:R06" | "residue:R03". Zone edges are not
   * flaggable (ruled out round 1). Flags live on the B side — the run under judgment. */
  flags: string[];
  /** One free-text note per staged item, TASTE.md-verdict shaped. No per-flag notes. */
  note: string;
  stagedAt: number;
};

export type ExportRecord = {
  verb: "chat" | "sheet" | "snip";
  dir: string;
  stamp: string;
  files: string[];
  manifestPath: string;
  /** The set's own rehydration link — open it to reload this staging, editable. */
  setUrl: string;
  /** The exact clip block (always built; clip.txt always holds it). */
  text: string;
  /** Where the copy landed: "os" (Set-Clipboard, the primary), "browser" (navigator
   * fallback), or null (both refused — copy from the block by hand). */
  copiedVia: "os" | "browser" | null;
  opened: string | null;
  warning: string | null;
  atUtc: string;
};

type FbState = {
  items: StagedItem[];
  /** `${itemKey}::${el}` of the flag chip under the cursor — the panel lights that shape. */
  hoverFlag: string | null;
  /** The ?set= stamp this staging was rehydrated from, if any — provenance, not a lock. */
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
  state: { items: [], hoverFlag: null, loadedSet: null, exporting: null, lastExport: null, exportError: null },
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
  return useSyncExternalStore(subscribe, () => store.state, () => store.state);
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

  /** ?set= rehydration: the manifest's items become the staging, editable. */
  replaceAll(items: StagedItem[], loadedSet: string | null) {
    emit({ items, loadedSet });
  },

  toggleFlag(key: string, el: string) {
    emit({
      items: store.state.items.map((i) =>
        i.key === key
          ? { ...i, flags: i.flags.includes(el) ? i.flags.filter((f) => f !== el) : [...i.flags, el] }
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

/** "room:R06" → "room R06"; "residue:R03" → "residue R03" (rooms and residues share the
 * R-number namespace in the TSVs, so the kind prefix is load-bearing). */
export function flagLabel(el: string): string {
  const [kind, id] = el.split(":");
  return `${kind} ${id}`;
}
