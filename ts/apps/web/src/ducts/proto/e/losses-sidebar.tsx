/**
 * THROWAWAY (protoui round 2, E1 "losses sidebar"): the losses item as a kit `Tree`. One root per
 * grille, worst first, its trailing bar the fan-to-grille total against the critical run. Opening a
 * grille lists the legs on its path, and a leg its elements, each with its own (self) loss. The
 * row verb opens the edit popover (the losses rule editor) for that grille.
 */
import { Tree } from "@pe/kit/lang/row";

import type { TreeNode } from "../b/model";
import { MetaBar } from "./bar";
import { EditVerb, rowParts } from "./rows";
import type { Sidebar, SidebarCtx } from "./screen";

function LossesTree({ ctx }: { ctx: SidebarCtx }) {
  const runs = [...ctx.tree.children].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  return (
    <Tree<TreeNode>
      aria-label="grilles by loss"
      roots={runs}
      keyOf={(n) => n.key}
      childrenOf={(n) => n.children}
      onPick={(n) => ctx.select(n.kind === "run" ? n.terminal : n.id)}
      empty="no priced grille path in this system"
      row={(n) =>
        rowParts(ctx, n, {
          label: ctx.grilleName(n),
          meta:
            n.kind === "run" ? (
              <MetaBar value={n.total} scale={ctx.scale} provisional={n.provisional} />
            ) : (
              <span className="text-ink-2">{n.self == null ? "—" : `+${n.self.toFixed(3)}`}</span>
            ),
          actions: (
            <EditVerb
              ctx={ctx}
              node={n}
              title={n.kind === "run" ? `grille ${ctx.grilleName(n)}` : n.name}
            />
          ),
        })
      }
    />
  );
}

export const LOSSES_SIDEBAR: Sidebar = {
  title: "losses",
  render: (ctx) => <LossesTree key={ctx.tree.key} ctx={ctx} />,
};
