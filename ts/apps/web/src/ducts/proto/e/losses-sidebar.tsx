/**
 * THROWAWAY (protoui round 2, E1 "losses sidebar"): the losses item, compacted. One row per grille,
 * worst first, its bar the fan-to-grille total against the critical run. Expanding a row opens its
 * drawer: the legs on the grille's path and the elements in them, each with its own (self) loss.
 * "rules" opens the edit popover (the losses rule editor) for that grille. Names wrap, never cut.
 */
import { useState } from "react";

import type { TreeNode } from "../b/model";
import { fmt, LossBar } from "./bar";
import { idsOf, type Sidebar, type SidebarCtx } from "./screen";

const terminalName = (run: TreeNode) =>
  `${run.name.split(" → ").at(-1) ?? run.name}${run.terminal == null ? "" : ` ${run.terminal}`}`;

function EditButton({ ctx, node, title }: { ctx: SidebarCtx; node: TreeNode; title: string }) {
  return (
    <button
      type="button"
      aria-label={`edit ${title}`}
      data-e-edit-open={node.key}
      className="text-ink-2 hover:text-ink t-small shrink-0 cursor-pointer px-1"
      onClick={(e) => {
        e.stopPropagation();
        ctx.edit({
          anchor: e.currentTarget,
          title,
          terminal: node.terminal,
          element: node.kind === "element" ? node.id : null,
        });
      }}
    >
      rules…
    </button>
  );
}

function Self({ value }: { value: number | null }) {
  return (
    <span className="face-mono text-ink-2 w-14 shrink-0 text-right" title="self: this part's own loss, in-wg">
      {value == null ? "—" : `+${fmt(value)}`}
    </span>
  );
}

function LossesList({ ctx }: { ctx: SidebarCtx }) {
  const runs = [...ctx.tree.children].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <ol aria-label="grilles by loss" data-e-sidebar="losses">
      {runs.map((run) => {
        const isOpen = open.has(run.key);
        const name = terminalName(run);
        return (
          <li key={run.key} className="border-line border-b">
            <div
              data-e-row={run.key}
              className="flex cursor-pointer items-start gap-1 px-2 py-1 hover:bg-(--pe-recess)"
              style={ctx.selected === run.terminal ? { background: "var(--pe-recess)" } : undefined}
              onMouseEnter={() => ctx.light(idsOf(run))}
              onClick={() => ctx.select(run.terminal)}
            >
              <button
                type="button"
                aria-label={isOpen ? "collapse" : "expand"}
                aria-expanded={isOpen}
                data-e-toggle={run.key}
                className="text-ink-2 w-3 shrink-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(run.key);
                }}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <span className="min-w-0 flex-1 break-words">
                  {run.critical || run.key === ctx.criticalKey ? (
                    <span
                      className="mr-1"
                      title={
                        run.critical === "pe"
                          ? "Pe's critical run (largest total)"
                          : "longest developed run: stand-in until priced"
                      }
                    >
                      {run.critical === "longest" && run.key !== ctx.criticalKey ? "◇" : "◆"}
                    </span>
                  ) : null}
                  {name}
                </span>
                <span className="flex w-40 shrink-0">
                <LossBar
                  value={run.total}
                  scale={ctx.scale}
                  provisional={run.provisional}
                  label="loss from the fan to this grille, in-wg (Pe)"
                />
                </span>
              </div>
              <EditButton ctx={ctx} node={run} title={`grille ${name}`} />
            </div>
            {isOpen ? (
              <ol className="pb-1 pl-6" data-e-drawer={run.key}>
                {run.children.map((leg) => (
                  <li key={leg.key}>
                    <div
                      className="flex items-start gap-2 py-0.5 pr-2 hover:bg-(--pe-recess)"
                      onMouseEnter={() => ctx.light(idsOf(leg))}
                      onClick={() => ctx.select(leg.id)}
                    >
                      <span className="min-w-0 flex-1 break-words">{leg.name}</span>
                      <Self value={leg.self} />
                    </div>
                    <ol className="pl-3">
                      {leg.children
                        .filter((el) => el.self == null || el.self > 0)
                        .map((el) => (
                          <li
                            key={el.key}
                            className="text-ink-2 t-small flex items-start gap-2 py-0.5 pr-2 hover:bg-(--pe-recess)"
                            onMouseEnter={() => ctx.light(el.id == null ? null : [el.id])}
                            onClick={() => ctx.select(el.id)}
                          >
                            <span className="min-w-0 flex-1 break-words">{el.name}</span>
                            <Self value={el.self} />
                            <EditButton ctx={ctx} node={el} title={el.name} />
                          </li>
                        ))}
                    </ol>
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export const LOSSES_SIDEBAR: Sidebar = {
  title: "losses",
  render: (ctx) => <LossesList key={ctx.tree.key} ctx={ctx} />,
};
