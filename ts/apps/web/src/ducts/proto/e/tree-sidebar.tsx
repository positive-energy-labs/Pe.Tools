/**
 * THROWAWAY (protoui round 3, E2 "tree sidebar"): B's topology (system → runs → legs → elements) as
 * a kit `Tree`. Each row's trailing slot: the fan-to-here total as a bar, then its own (self) loss.
 * An element a rule prices carries one verb: jump to its type's rule in the Rules section. There is
 * no per-row rule editor: a rule is global (family:type plus condition), never one fitting's.
 */
import { useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { Tree } from "@pe/kit/lang/row";

import type { TreeNode } from "../b/model";
import { MetaBar } from "./bar";

export interface TreeCtx {
  tree: TreeNode;
  /** Full bar width: the critical run's total, in-wg; null unpriced. */
  scale: number | null;
  /** The critical run's key: the run with the largest priced total. */
  criticalKey: string | null;
  /** A grille's name for a run (or a grille element): label, else type, plus place; never an id. */
  grilleName: (node: TreeNode) => string;
  /** The element id the route has selected, or null. */
  selected: number | null;
  /** Each priced fitting's rule key. */
  ruleOf: ReadonlyMap<number, string>;
  light: (ids: readonly number[] | null) => void;
  select: (id: number | null) => void;
  jumpToRule: (ruleKey: string) => void;
}

/** Every element id under a node, its own first: the set a hover lights. */
export const idsOf = (node: TreeNode): number[] => {
  const out = new Set<number>();
  const walk = (n: TreeNode) => {
    if (n.kind === "element" && n.id != null) out.add(n.id);
    n.children.forEach(walk);
  };
  if (node.id != null) out.add(node.id);
  walk(node);
  return [...out];
};

export function SystemTree({ ctx }: { ctx: TreeCtx }) {
  const crit = ctx.tree.children.find((r) => r.key === ctx.criticalKey) ?? ctx.tree.children[0];
  // Controlled: the kit Tree's own state is fine too; kept here so a jump could open a run later.
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
      row={(n) => {
        const label =
          n.kind === "run" ? runName(n) : n.kind === "element" ? ctx.grilleName(n) : n.name;
        const critical = n.kind === "run" && (n.key === ctx.criticalKey || n.critical != null);
        const stand = n.critical === "longest" && n.key !== ctx.criticalKey;
        const ruleKey = n.kind === "element" && n.id != null ? ctx.ruleOf.get(n.id) : undefined;
        return {
          lead: critical ? (
            <span title={stand ? "longest developed run: stand-in until priced" : "critical run"}>
              {stand ? "◇" : "◆"}
            </span>
          ) : undefined,
          label: <span className={n.kind === "system" ? "font-medium" : undefined}>{label}</span>,
          // Always a title: the kit Row wraps itself in a Tooltip only once it measures a cut
          // title, and that late wrap re-renders the row and drops the chevron's first press.
          title: label,
          meta: (
            <MetaBar
              value={n.total}
              scale={ctx.scale}
              provisional={n.provisional}
              self={n.kind === "leg" || n.kind === "element" ? n.self : ""}
            />
          ),
          actions: ruleKey ? (
            <Button
              icon={ListTree}
              label="jump to its type's rule"
              data-e-jump={ruleKey}
              onClick={(e) => {
                e.stopPropagation();
                ctx.jumpToRule(ruleKey);
              }}
            />
          ) : undefined,
          selected:
            ctx.selected != null &&
            n.kind !== "system" &&
            (n.kind === "run" ? n.terminal : n.id) === ctx.selected,
          onMouseEnter: () => ctx.light(idsOf(n)),
        };
      }}
    />
  );
}
