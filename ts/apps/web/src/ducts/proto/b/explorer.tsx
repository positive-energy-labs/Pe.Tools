/**
 * THROWAWAY (protoui round 1, variant B): the profiler call tree. Rows are kit `Row`s; the
 * keyboard is local (up/down move, right expands, left collapses, Enter selects, Space edits).
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Row } from "@pe/kit/lang/row";
import { tokenRef } from "@pe/kit/lib/token";

import { visibleRows, type TreeNode } from "./model";

const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(3));

function Bar({ node }: { node: TreeNode }) {
  const share = node.total != null && node.scale ? Math.min(1, node.total / node.scale) : null;
  return (
    <span className="inline-flex items-center gap-1" title="total: fan to here, in-wg (Pe)">
      {/* Unpriced draws no track: an empty bar would read as zero loss. */}
      {share != null ? (
        <span
          className="relative inline-block h-1.5 w-12"
          style={{ backgroundColor: tokenRef("line") }}
          aria-hidden
        >
          <span
            className="absolute inset-y-0 left-0"
            style={{ width: `${share * 100}%`, backgroundColor: tokenRef("ink-2") }}
          />
        </span>
      ) : null}
      <span className="face-mono w-10 text-right">{fmt(node.total)}</span>
      {node.provisional ? (
        <span data-tone="caution" title={`provisional: rests on ${node.provisional.count} unruled inferred join(s), worst ${node.provisional.worst}`}>
          ~
        </span>
      ) : null}
    </span>
  );
}

export function Explorer({
  roots,
  selectedKey,
  onPick,
  onHover,
  onEdit,
}: {
  roots: readonly TreeNode[];
  selectedKey: string | null;
  onPick: (node: TreeNode) => void;
  onHover: (id: number | null) => void;
  /** Open the edit popover for a node, anchored at `anchor`. */
  onEdit: (node: TreeNode, anchor: HTMLElement) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = roots[0];
    const crit = first?.children.find((r) => r.critical) ?? first?.children[0];
    return new Set([first?.key, crit?.key].filter((k): k is string => !!k));
  });
  const rows = useMemo(() => visibleRows(roots, open), [roots, open]);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const toggle = (key: string, on: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const rowEl = (key: string) =>
    box.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = rows[cursor];
    if (!at) return;
    const move = (i: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, i));
      setCursor(next);
      rowEl(rows[next]!.node.key)?.scrollIntoView({ block: "nearest" });
      onHover(rows[next]!.node.id);
    };
    switch (event.key) {
      case "ArrowDown":
        move(cursor + 1);
        break;
      case "ArrowUp":
        move(cursor - 1);
        break;
      case "ArrowRight":
        if (at.node.children.length && !open.has(at.node.key)) toggle(at.node.key, true);
        else if (open.has(at.node.key)) move(cursor + 1);
        break;
      case "ArrowLeft":
        if (open.has(at.node.key)) toggle(at.node.key, false);
        else if (at.parent) move(rows.findIndex((r) => r.node.key === at.parent));
        break;
      case "Enter":
        onPick(at.node);
        break;
      case " ": {
        const el = rowEl(at.node.key);
        if (el) onEdit(at.node, el);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      ref={box}
      role="tree"
      aria-label="system call tree"
      tabIndex={0}
      className="flex min-h-0 flex-1 flex-col overflow-auto outline-none"
      onKeyDown={onKeyDown}
      onMouseLeave={() => onHover(null)}
    >
      <div className="text-ink-2 t-small flex justify-between px-2 py-1">
        <span>system · run · leg · element</span>
        <span>total · self (in-wg)</span>
      </div>
      {rows.map(({ node, depth }, i) => {
        const expandable = node.children.length > 0;
        const isOpen = open.has(node.key);
        const selected = node.key === selectedKey;
        return (
          <Row
            key={node.key}
            data-key={node.key}
            role="treeitem"
            cursor={i === cursor}
            selected={selected}
            title={undefined}
            onMouseEnter={() => onHover(node.id)}
            onClick={() => {
              setCursor(i);
              box.current?.focus();
              onPick(node);
            }}
            lead={
              <span className="inline-flex items-center" style={{ paddingLeft: depth * 12 }}>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={isOpen ? "collapse" : "expand"}
                  className="text-ink-2 w-3 cursor-pointer"
                  style={{ visibility: expandable ? "visible" : "hidden" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(node.key, !isOpen);
                  }}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              </span>
            }
            label={
              <span className={node.kind === "system" ? "font-medium" : undefined}>
                {node.critical ? (
                  <span
                    title={
                      node.critical === "pe"
                        ? "Pe's critical run (largest total)"
                        : "longest developed run: stand-in until priced"
                    }
                    className="mr-1"
                  >
                    {node.critical === "pe" ? "◆" : "◇"}
                  </span>
                ) : null}
                {node.name}
              </span>
            }
            meta={
              <span className="inline-flex items-center gap-2">
                <Bar node={node} />
                <span className="face-mono text-ink-2 w-10 text-right" title="self: this node's own loss, in-wg">
                  {node.kind === "run" || node.kind === "system" ? "" : fmt(node.self)}
                </span>
                {selected ? (
                  <button
                    type="button"
                    aria-label={`edit ${node.name}`}
                    className="cursor-pointer px-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(node, e.currentTarget);
                    }}
                  >
                    …
                  </button>
                ) : (
                  <span className="inline-block w-[14px]" />
                )}
              </span>
            }
          />
        );
      })}
    </div>
  );
}
