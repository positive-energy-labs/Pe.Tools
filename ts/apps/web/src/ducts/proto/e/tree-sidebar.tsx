/**
 * THROWAWAY (protoui round 2, E2 "tree sidebar"): B's topology (system → runs → legs → elements) as
 * a kit `Tree`. Each row's trailing slot: the fan-to-here total as a bar, then its own (self) loss.
 * The row verb opens the edit popover.
 */
import { useState } from "react";
import { Tree } from "@pe/kit/lang/row";

import type { TreeNode } from "../b/model";
import { MetaBar } from "./bar";
import { EditVerb, rowParts } from "./rows";
import type { Sidebar, SidebarCtx } from "./screen";

function SystemTree({ ctx }: { ctx: SidebarCtx }) {
  const crit = ctx.tree.children.find((r) => r.key === ctx.criticalKey) ?? ctx.tree.children[0];
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set([ctx.tree.key, ...(crit ? [crit.key] : [])]),
  );
  const runName = (n: TreeNode) => `${n.name.split(" → ")[0]} → ${ctx.grilleName(n)}`;
  return (
    <Tree<TreeNode>
      aria-label="system tree"
      roots={[ctx.tree]}
      keyOf={(n) => n.key}
      childrenOf={(n) => n.children}
      open={open}
      onOpenChange={setOpen}
      onPick={(n) => ctx.select(n.kind === "run" ? n.terminal : n.id)}
      empty="no run in this system"
      row={(n) =>
        rowParts(ctx, n, {
          label: n.kind === "run" ? runName(n) : n.kind === "element" ? ctx.grilleName(n) : n.name,
          meta: (
            <MetaBar
              value={n.total}
              scale={ctx.scale}
              provisional={n.provisional}
              self={n.kind === "leg" || n.kind === "element" ? n.self : ""}
            />
          ),
          actions:
            n.kind === "system" ? null : (
              <EditVerb
                ctx={ctx}
                node={n}
                title={`${n.kind}: ${n.kind === "run" ? runName(n) : n.name}`}
              />
            ),
        })
      }
    />
  );
}

export const TREE_SIDEBAR: Sidebar = {
  title: "system",
  render: (ctx) => <SystemTree key={ctx.tree.key} ctx={ctx} />,
};
