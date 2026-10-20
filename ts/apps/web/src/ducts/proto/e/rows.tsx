/**
 * THROWAWAY (protoui round 2, E1/E2): what both sidebar trees put in a kit `Row`: the critical mark,
 * the name, the hover that lights the row's element set, the selection, and the edit verb.
 */
import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import type { TreeRowParts } from "@pe/kit/lang/row";

import type { TreeNode } from "../b/model";
import { idsOf, type SidebarCtx } from "./screen";

export function rowParts(
  ctx: SidebarCtx,
  n: TreeNode,
  parts: { label: string; meta: ReactNode; actions: ReactNode },
): TreeRowParts {
  const critical = n.kind === "run" && (n.key === ctx.criticalKey || n.critical != null);
  const stand = n.critical === "longest" && n.key !== ctx.criticalKey;
  return {
    lead: critical ? (
      <span
        title={stand ? "longest developed run: stand-in until priced" : "critical run (largest total)"}
      >
        {stand ? "◇" : "◆"}
      </span>
    ) : undefined,
    label: <span className={n.kind === "system" ? "font-medium" : undefined}>{parts.label}</span>,
    // Always a title: the kit Row wraps itself in a Tooltip only once it measures a cut title, and
    // that late wrap re-renders the row under the pointer and drops the chevron's first press.
    title: parts.label,
    meta: parts.meta,
    actions: parts.actions,
    selected:
      ctx.selected != null &&
      n.kind !== "system" &&
      (n.kind === "run" ? n.terminal : n.id) === ctx.selected,
    onMouseEnter: () => ctx.light(idsOf(n)),
  };
}

export function EditVerb({ ctx, node, title }: { ctx: SidebarCtx; node: TreeNode; title: string }) {
  return (
    <Button
      label="rules and drops on this path"
      icon={SlidersHorizontal}
      data-e-edit-open={node.key}
      onClick={(e) => {
        e.stopPropagation();
        ctx.edit({
          anchor: e.currentTarget,
          title,
          terminal: node.terminal ?? (node.kind === "run" ? node.id : null),
          element: node.kind === "element" ? node.id : null,
        });
      }}
    />
  );
}
