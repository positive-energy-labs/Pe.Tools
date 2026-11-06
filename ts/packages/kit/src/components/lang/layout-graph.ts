import type { LayoutNode } from "@pe/agent-contracts";

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
