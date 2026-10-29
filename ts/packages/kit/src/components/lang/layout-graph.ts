import { pane, split, type LayoutNode } from "@pe/agent-contracts";

/** Remove closed gates bottom-up, leaving no empty split tracks. Never mutates the declaration. */
export function reduceLayout(
  tree: LayoutNode,
  active: (when: string) => boolean,
): LayoutNode | null {
  switch (tree.kind) {
    case "pane":
      return tree;
    case "gate":
      return active(tree.when) ? reduceLayout(tree.child, active) : null;
    case "split": {
      const children = tree.children.flatMap((child) => {
        const reduced = reduceLayout(child, active);
        return reduced ? [reduced] : [];
      });
      if (children.length < 2) return children[0] ?? null;
      return { ...tree, children };
    }
  }
}

/** Kit owns presentation presets; contracts remain independent of kit. */
const identity = (node: LayoutNode): string =>
  node.kind === "gate" ? identity(node.child) : node.id;

export function sidebars({
  start,
  main,
  end,
}: {
  start?: LayoutNode;
  main: LayoutNode;
  end?: LayoutNode;
}): LayoutNode {
  const framed = end
    ? split(
        JSON.stringify(["sidebars:end", identity(main), identity(end)]),
        { axis: "h", sized: "end", size: 320 },
        main,
        end,
      )
    : main;
  return start
    ? split(
        JSON.stringify(["sidebars:start", identity(start), identity(framed)]),
        { axis: "h", sized: "start", size: 320 },
        start,
        framed,
      )
    : framed;
}

export function withDoc(main: LayoutNode, doc: LayoutNode | string): LayoutNode {
  return sidebars({ main, end: typeof doc === "string" ? pane(doc) : doc });
}
