// THROWAWAY — /runs feedback-loop round 1 (proto). The shared staging store all three ?fb=
// variants ride: which zone A/B cards are staged for export, which elements are flagged, and
// the one note per staged item. In-memory only, by rule — the only persistence this loop is
// allowed is the export write itself.
//
// Deliberately an external store (module singleton + useSyncExternalStore), not context: the
// variants mount in three structurally different places (overlay tray, full-viewport deck,
// ledger rider) and the flag handlers live inside the promoted ZonePanel — one store keeps the
// browser.tsx patch to a hook call.
import { useSyncExternalStore } from "react";

import type { ZoneRecord } from "../world";

export type FbVariant = "tray" | "deck" | "ledger";

/** A staged A/B card, snapshotted at stage time. If the user scrubs to another run pair the
 * staged item keeps the pair it was staged FROM — a verdict is about a specific comparison. */
export type StagedItem = {
  key: string;
  zone: string;
  level: string;
  runA: string | null;
  runB: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  /** Flagged element ids — DATA, not pixels: "room:R06" | "residue:R03". Zone edges are not
   * flaggable (ruled out for round 1). */
  flags: string[];
  /** One free-text note per staged item, TASTE.md-verdict shaped. No per-flag notes. */
  note: string;
  stagedAt: number;
};

export type ExportRecord = {
  verb: "chat" | "sheet" | "snip";
  dir: string;
  files: string[];
  manifestPath: string;
  /** The exact clipboard text block (chat verb only). */
  text: string | null;
  opened: string | null;
  /** Non-fatal trouble after the files landed (e.g. clipboard permission denied). */
  warning: string | null;
  atUtc: string;
};

type FbState = {
  variant: FbVariant | null;
  items: StagedItem[];
  deckOpen: boolean;
  exporting: ExportRecord["verb"] | null;
  lastExport: ExportRecord | null;
  exportError: string | null;
};

export function itemKey(zone: string, runA: string | null, runB: string): string {
  return `${zone}::${runA ?? "-"}::${runB}`;
}

function readVariantFromUrl(): FbVariant | null {
  if (typeof window === "undefined") return null;
  const fb = new URLSearchParams(window.location.search).get("fb");
  return fb === "tray" || fb === "deck" || fb === "ledger" ? fb : null;
}

let state: FbState = {
  variant: readVariantFromUrl(),
  items: [],
  deckOpen: false,
  exporting: null,
  lastExport: null,
  exportError: null,
};

const listeners = new Set<() => void>();

function emit(next: Partial<FbState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFb(): FbState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const fb = {
  get: () => state,

  setVariant(variant: FbVariant | null) {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (variant) url.searchParams.set("fb", variant);
      else url.searchParams.delete("fb");
      window.history.replaceState(null, "", url);
    }
    // Staging survives a variant switch on purpose — same review, different chrome.
    emit({ variant, deckOpen: false });
  },

  toggleStage(item: Omit<StagedItem, "flags" | "note" | "stagedAt">) {
    const existing = state.items.find((i) => i.key === item.key);
    emit({
      items: existing
        ? state.items.filter((i) => i.key !== item.key)
        : [...state.items, { ...item, flags: [], note: "", stagedAt: Date.now() }],
    });
  },

  unstage(key: string) {
    emit({ items: state.items.filter((i) => i.key !== key) });
  },

  clear() {
    emit({ items: [], deckOpen: false });
  },

  toggleFlag(key: string, el: string) {
    emit({
      items: state.items.map((i) =>
        i.key === key
          ? { ...i, flags: i.flags.includes(el) ? i.flags.filter((f) => f !== el) : [...i.flags, el] }
          : i,
      ),
    });
  },

  setNote(key: string, note: string) {
    emit({ items: state.items.map((i) => (i.key === key ? { ...i, note } : i)) });
  },

  setDeckOpen(deckOpen: boolean) {
    emit({ deckOpen });
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
