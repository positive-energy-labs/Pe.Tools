import type { LayoutNode, PaneDecl } from "@pe/agent-contracts";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { reduceLayout } from "./layout-graph";
import { declaredTeaching, type TeachingLayout } from "./teach";
import { TeachingLayoutView, type TeachingPaneRender } from "./teaching-layout";
import { TeachReference } from "./use-teach";
import type { PaneSide } from "./pane-resize";

export type PaneApi = TeachingPaneRender;
export type GraphPaneState = {
  folded?: boolean;
  /** A pane can anchor more than one seam, including seams on different axes. */
  sizes?: Readonly<Record<string, number>>;
};
export type GraphLayoutState = Readonly<Record<string, GraphPaneState>>;
export interface GraphLayoutViewProps {
  layout: LayoutNode;
  panes: Readonly<Record<string, PaneDecl>>;
  active: (when: string) => boolean;
  bodies: Readonly<Record<string, (pane: PaneApi) => ReactNode>>;
  /** Device state. Omit to retain it locally for this mounted graph. */
  state?: { panes: GraphLayoutState; onChange: (next: GraphLayoutState) => void };
}

type Binding = { id: string; owner: string; start?: string; end?: string };
const anchor = (node: TeachingLayout, side: PaneSide): string =>
  "axis" in node ? anchor(node[side], side) : node.id;

function project(layout: LayoutNode, panes: GraphLayoutViewProps["panes"]) {
  const bindings: Binding[] = [];
  const visit = (node: LayoutNode): TeachingLayout => {
    if (node.kind === "gate") return visit(node.child); // Only open gates survive reduction.
    if (node.kind === "pane") {
      const declared = panes[node.id];
      if (!declared) throw new Error(`Missing pane declaration ${node.id}`);
      return {
        id: node.id,
        label: declared.label,
        purpose: declared.purpose,
        pane: declared.frame,
      };
    }
    const children = node.children.map(visit);
    // PaneSplit is binary. Ordered n-ary splits lower to seams sizing each outer child.
    const pair = (children: readonly TeachingLayout[]): TeachingLayout => {
      if (children.length === 1) return children[0]!;
      const start = node.sized === "start" ? children[0]! : pair(children.slice(0, -1));
      const end = node.sized === "end" ? children.at(-1)! : pair(children.slice(1));
      const owner = anchor(node.sized === "start" ? start : end, node.sized);
      const id = JSON.stringify([node.id, owner]);
      const startId = "axis" in start ? undefined : start.id;
      const endId = "axis" in end ? undefined : end.id;
      bindings.push({ id, owner, start: startId, end: endId });
      return {
        id,
        axis: node.axis === "h" ? "horizontal" : "vertical",
        target: node.sized,
        size: node.size,
        minSize: node.minSize,
        maxSize: node.maxSize,
        minOtherSize: node.minOtherSize,
        persist: node.persist,
        start,
        end,
        rails: {
          ...("axis" in start ? {} : { start: { title: start.label, collapseBelow: 1 } }),
          ...("axis" in end ? {} : { end: { title: end.label, collapseBelow: 1 } }),
        },
      };
    };
    return pair(children);
  };
  return { layout: visit(layout), bindings };
}

/** RouteGraph owns topology and words; TeachingLayout owns Pane, split and measured teaching. */
export function GraphLayoutView({ layout, panes, active, bodies, state }: GraphLayoutViewProps) {
  const [local, setLocal] = useState<GraphLayoutState>({});
  const values = state?.panes ?? local;
  const current = useRef(values);
  current.current = values;
  const projection = useMemo(() => {
    const reduced = reduceLayout(layout, active);
    return reduced ? project(reduced, panes) : null;
  }, [layout, panes, active]);
  const reference = useMemo(
    () => (projection ? declaredTeaching(projection.layout) : []),
    [projection],
  );
  const change = (update: (prior: GraphLayoutState) => GraphLayoutState) => {
    const next = update(current.current);
    current.current = next;
    if (state) state.onChange(next);
    else setLocal(next);
  };
  if (!projection) return null;
  const folds = Object.fromEntries(
    projection.bindings.map(({ id, start, end }) => [
      id,
      {
        collapsed:
          start && values[start]?.folded
            ? ("start" as const)
            : end && values[end]?.folded
              ? ("end" as const)
              : null,
        onChange: (side: PaneSide | null) =>
          change((prior) => ({
            ...prior,
            ...(start ? { [start]: { ...prior[start], folded: side === "start" } } : {}),
            ...(end ? { [end]: { ...prior[end], folded: side === "end" } } : {}),
          })),
      },
    ]),
  );
  const sizes = Object.fromEntries(
    projection.bindings.map(({ id, owner }) => [
      id,
      {
        size: values[owner]?.sizes?.[id],
        onChange: (size: number) =>
          change((prior) => ({
            ...prior,
            [owner]: { ...prior[owner], sizes: { ...prior[owner]?.sizes, [id]: size } },
          })),
      },
    ]),
  );
  return (
    <TeachReference value={reference}>
      <TeachingLayoutView layout={projection.layout} content={bodies} state={{ folds, sizes }} />
    </TeachReference>
  );
}
