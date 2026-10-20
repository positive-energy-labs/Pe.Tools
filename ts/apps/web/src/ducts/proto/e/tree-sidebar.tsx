/**
 * THROWAWAY (protoui round 2, E2 "tree sidebar"): B's topology tree (system → runs → legs →
 * elements) with the shared bar legend. Each row: total from the fan as a bar, its own (self) loss,
 * and "rules…" for the edit popover. Names wrap, never cut.
 */
import { useState } from "react";

import { visibleRows, type TreeNode } from "../b/model";
import { fmt, LossBar } from "./bar";
import { idsOf, type Sidebar, type SidebarCtx } from "./screen";

function Tree({ ctx }: { ctx: SidebarCtx }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const crit = ctx.tree.children.find((r) => r.critical) ?? ctx.tree.children[0];
    return new Set([ctx.tree.key, ...(crit ? [crit.key] : [])]);
  });
  const rows = visibleRows([ctx.tree], open);
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const edit = (node: TreeNode, anchor: HTMLElement) =>
    ctx.edit({
      anchor,
      title: `${node.kind}: ${node.name}`,
      terminal: node.terminal ?? (node.kind === "run" ? node.id : null),
      element: node.kind === "element" ? node.id : null,
    });
  return (
    <ol role="tree" aria-label="system tree" data-e-sidebar="tree">
      {rows.map(({ node, depth }) => {
        const isOpen = open.has(node.key);
        const expandable = node.children.length > 0;
        return (
          <li
            key={node.key}
            role="treeitem"
            data-e-row={node.key}
            className="flex cursor-pointer items-start gap-1 py-0.5 pr-2 hover:bg-(--pe-recess)"
            style={{
              paddingLeft: 8 + depth * 12,
              ...(ctx.selected != null && ctx.selected === node.id && node.kind !== "system"
                ? { background: "var(--pe-recess)" }
                : {}),
            }}
            onMouseEnter={() => ctx.light(idsOf(node))}
            onClick={() => ctx.select(node.id)}
          >
            <button
              type="button"
              aria-label={isOpen ? "collapse" : "expand"}
              aria-expanded={isOpen}
              data-e-toggle={node.key}
              className="text-ink-2 w-3 shrink-0 cursor-pointer"
              style={{ visibility: expandable ? "visible" : "hidden" }}
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.key);
              }}
            >
              {isOpen ? "▾" : "▸"}
            </button>
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <span className={`min-w-0 flex-1 break-words ${node.kind === "system" ? "font-medium" : ""}`}>
                {node.critical || node.key === ctx.criticalKey ? (
                  <span className="mr-1" title={node.critical === "pe" ? "Pe's critical run" : "longest run"}>
                    {node.critical === "longest" && node.key !== ctx.criticalKey ? "◇" : "◆"}
                  </span>
                ) : null}
                {node.name}
              </span>
              <span className="flex w-44 shrink-0 items-center gap-2">
                <LossBar
                  value={node.total}
                  scale={ctx.scale}
                  provisional={node.provisional}
                  label="loss from the fan to the far end of this row, in-wg (Pe)"
                />
                <span
                  className="face-mono text-ink-2 w-14 shrink-0 text-right"
                  title="self: this row's own loss, in-wg"
                >
                  {node.kind === "leg" || node.kind === "element"
                    ? node.self == null
                      ? "—"
                      : `+${fmt(node.self)}`
                    : ""}
                </span>
              </span>
            </div>
            {node.kind !== "system" ? (
              <button
                type="button"
                aria-label={`edit ${node.name}`}
                data-e-edit-open={node.key}
                className="text-ink-2 hover:text-ink t-small shrink-0 cursor-pointer px-1"
                onClick={(e) => {
                  e.stopPropagation();
                  edit(node, e.currentTarget);
                }}
              >
                rules…
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export const TREE_SIDEBAR: Sidebar = {
  title: "system",
  render: (ctx) => <Tree key={ctx.tree.key} ctx={ctx} />,
};
