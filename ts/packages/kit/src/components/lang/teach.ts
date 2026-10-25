import type { ScopeGesture } from "../../keys";
/** Declarations and measured facts share this vocabulary; only measurements carry current state. */
export type TeachOption = {
  key: string;
  label: string;
  says?: string;
  active?: boolean;
  disabled?: boolean;
  place?: "tl" | "tr" | "bl" | "br";
};
export type TeachKey = ScopeGesture & {
  refusal?: string | null;
};
export type TeachRect = { left: number; top: number; width: number; height: number };
export type TeachDescriptor =
  | { kind: "region"; label: string; purpose?: string; rect?: TeachRect }
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
export type Teaching = TeachDescriptor & {
  id: string;
  region?: string;
  page?: string;
  source?: "reference";
};

/** A binary layout is projected before mounting and rendered by the same split topology. */
export type TeachingLayout =
  | { id: string; label: string; purpose?: string; controls?: readonly TeachDescriptor[] }
  | {
      id: string;
      axis: "horizontal" | "vertical";
      target: "start" | "end";
      size: number;
      start: TeachingLayout;
      end: TeachingLayout;
    };

export function declaredTeaching(
  layout: TeachingLayout,
  width = 1440,
  height = 800,
): readonly Teaching[] {
  const facts: Teaching[] = [];
  const visit = (node: TeachingLayout, rect: TeachRect) => {
    if (!("axis" in node)) {
      facts.push({
        kind: "region",
        id: node.id,
        label: node.label,
        purpose: node.purpose,
        rect,
        source: "reference",
      });
      node.controls?.forEach((control, i) => {
        // Declarations never testify to a current selection, refusal or availability.
        const description =
          control.kind === "modes" || control.kind === "views"
            ? {
                ...control,
                options: control.options.map(
                  ({ active: _active, disabled: _disabled, ...option }) => option,
                ),
              }
            : control.kind === "keys"
              ? { ...control, items: control.items.map(({ refusal: _refusal, ...key }) => key) }
              : control;
        facts.push({ ...description, id: `${node.id}:${i}`, region: node.id, source: "reference" });
      });
      return;
    }
    const horizontal = node.axis === "horizontal";
    const extent = horizontal ? rect.width : rect.height;
    const start = Math.max(0, node.target === "start" ? node.size : extent - node.size);
    visit(node.start, {
      ...rect,
      width: horizontal ? start : rect.width,
      height: horizontal ? rect.height : start,
    });
    visit(node.end, {
      left: rect.left + (horizontal ? start : 0),
      top: rect.top + (horizontal ? 0 : start),
      width: horizontal ? extent - start : rect.width,
      height: horizontal ? rect.height : extent - start,
    });
  };
  visit(layout, { left: 0, top: 0, width, height });
  return facts;
}
/** Keep screen coordinates until the diagram scales the entire page by one factor. */
export function measureRegions(facts: readonly Teaching[]) {
  const visible = facts
    .flatMap((f) =>
      f.kind === "region" && f.rect && f.rect.width > 0 && f.rect.height > 0
        ? [{ key: f.id, label: f.label, ...f.rect }]
        : [],
    )
    .sort((a, b) => a.left - b.left || a.top - b.top);
  const left = Math.min(...visible.map((r) => r.left));
  const top = Math.min(...visible.map((r) => r.top));
  const regions = visible.map((r) => ({ ...r, left: r.left - left, top: r.top - top }));
  return {
    regions,
    width: Math.max(1, ...regions.map((r) => r.left + r.width)),
    height: Math.max(1, ...regions.map((r) => r.top + r.height)),
  };
}
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
