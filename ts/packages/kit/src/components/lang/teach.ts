import type { ScopeGesture } from "../../keys";
/** Mounted facts only. React and DOM adapters live in use-teach; kit owns the vocabulary. */
export type TeachOption = {
  key: string;
  label: string;
  says?: string;
  active: boolean;
  disabled?: boolean;
  place?: "tl" | "tr" | "bl" | "br";
};
export type TeachKey = ScopeGesture & {
  refusal?: string | null;
};
export type TeachDescriptor =
  | { kind: "region"; label: string; purpose?: string }
  | {
      kind: "keys";
      label?: never;
      scope: string;
      depth?: number;
      gestures?: boolean;
      items: readonly TeachKey[];
    }
  | {
      kind: "search";
      label: string;
      fields: readonly {
        label: string;
        operators: readonly string[];
        examples: readonly string[];
      }[];
      syntax: readonly string[];
    }
  | { kind: "modes" | "views"; label: string; options: readonly TeachOption[] };
export type Teaching = TeachDescriptor & { id: string; region?: string };
const mounted = new Map<string, Teaching>();
const listeners = new Set<() => void>();
let snapshot: readonly Teaching[] = [];
const changed = () => {
  snapshot = [...mounted.values()];
  listeners.forEach((notify) => notify());
};
export const readTeaching = () => snapshot;
export const subscribeTeaching = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};
export function registerTeaching(entry: Teaching) {
  mounted.set(entry.id, entry);
  changed();
  return () => {
    if (mounted.get(entry.id) !== entry) return;
    mounted.delete(entry.id);
    changed();
  };
}
