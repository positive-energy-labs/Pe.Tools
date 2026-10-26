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
type TeachingPath = readonly { split: string; side: "start" | "end"; choice?: string }[];
export type TeachDescriptor =
  | {
      kind: "region";
      label: string;
      purpose?: string;
      rect?: TeachRect;
      referenceRect?: TeachRect;
      path?: TeachingPath;
      available?: boolean;
      refusal?: string;
      foldedBy?: readonly string[];
      visibility?: "visible" | "folded" | "unmounted";
      rail?: { id: string; label: string; rect: TeachRect; orientation: "horizontal" | "vertical" };
    }
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
  instance?: string;
  instanceVisible?: boolean;
  node?: string;
};

/** A binary layout is projected before mounting and rendered by the same split topology. */
export type TeachingLayout =
  | {
      id: string;
      label: string;
      purpose?: string;
      controls?: readonly TeachDescriptor[];
      available?: string;
      mount?: string;
      pane?: {
        scroll?: "auto" | "clip" | "visible";
        flush?: boolean;
        header?: false;
        picture?: boolean;
      };
    }
  | {
      id: string;
      axis: "horizontal" | "vertical";
      target: "start" | "end";
      size: number;
      minSize?: number;
      minOtherSize?: number | { when: string; yes: number; no: number };
      maxSize?: number;
      persist?: string;
      available?: string;
      choice?: string;
      rails?: Partial<Record<"start" | "end", { title: string; collapseBelow?: number }>>;
      start: TeachingLayout;
      end: TeachingLayout;
    };

export function declaredTeaching(
  layout: TeachingLayout,
  width = 1440,
  height = 800,
): readonly Teaching[] {
  const facts: Teaching[] = [];
  const visit = (node: TeachingLayout, rect: TeachRect, path: TeachingPath = []) => {
    if (!("axis" in node)) {
      facts.push({
        kind: "region",
        id: node.id,
        label: node.label,
        purpose: node.purpose,
        rect,
        referenceRect: rect,
        path,
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
    const start = Math.min(
      extent,
      Math.max(
        0,
        node.choice ? extent / 2 : node.target === "start" ? node.size : extent - node.size,
      ),
    );
    visit(
      node.start,
      {
        ...rect,
        width: horizontal ? start : rect.width,
        height: horizontal ? rect.height : start,
      },
      [...path, { split: node.id, side: "start", choice: node.choice }],
    );
    visit(
      node.end,
      {
        left: rect.left + (horizontal ? start : 0),
        top: rect.top + (horizontal ? 0 : start),
        width: horizontal ? extent - start : rect.width,
        height: horizontal ? rect.height : extent - start,
      },
      [...path, { split: node.id, side: "end", choice: node.choice }],
    );
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
  const railMap = new Map(
    facts.flatMap((fact) =>
      fact.kind === "region" && fact.rail && fact.rail.rect.width > 0 && fact.rail.rect.height > 0
        ? [
            [
              fact.rail.id,
              {
                key: fact.rail.id,
                label: fact.rail.label,
                orientation: fact.rail.orientation,
                ...fact.rail.rect,
              },
            ] as const,
          ]
        : [],
    ),
  );
  const covering = [...visible, ...railMap.values()];
  const left = covering.length ? Math.min(...covering.map((r) => r.left)) : 0;
  const top = covering.length ? Math.min(...covering.map((r) => r.top)) : 0;
  const normalize = <T extends TeachRect>(r: T) => ({
    ...r,
    left: r.left - left,
    top: r.top - top,
  });
  return {
    regions: visible.map(normalize),
    rails: [...railMap.values()].map(normalize),
    width: Math.max(1, ...covering.map((r) => r.left - left + r.width)),
    height: Math.max(1, ...covering.map((r) => r.top - top + r.height)),
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
export function registerTeaching(entry: Teaching | readonly Teaching[]) {
  const entries: readonly Teaching[] = Array.isArray(entry) ? entry : [entry as Teaching];
  entries.forEach((fact) => mounted.set(fact.id, fact));
  changed();
  return () => {
    entries.forEach((fact) => {
      if (mounted.get(fact.id) === fact) mounted.delete(fact.id);
    });
    changed();
  };
}
