import { type ReactNode, useState } from "react";
import { cn } from "#/lib/utils";

/**
 * Readonly op-view primitives. The vocabulary: Revit-familiar shapes (browser
 * tree, schedule grid) rendered in the PE design language — 2px radii, hairline
 * borders, tele for machine-measured values, categorical tints for meaning.
 */

export type CatHue = "blue" | "green" | "slate" | "lichen" | "clay" | "kiln";

export function catVar(hue: CatHue): string {
  return `var(--cat-${hue})`;
}

/** Tinted categorical chip — 12% bg, 25% border, full hue text. */
export function Chip({
  hue = "slate",
  children,
  title,
  mono = true,
}: {
  hue?: CatHue;
  children: ReactNode;
  title?: string;
  mono?: boolean;
}) {
  const c = catVar(hue);
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius)] border px-1.5 py-px",
        mono ? "tele-label text-[10px]" : "text-[11px]",
      )}
      style={{
        color: c,
        backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 25%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

/** Section with a small-caps sans header — the block unit of every op view. */
export function OpSection({
  label,
  aside,
  children,
  className,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="section-label">{label}</h2>
        {aside && <div className="flex items-center gap-1.5">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label/value pairs; values are machine-measured so they read tele. */
export function KVGrid({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; hue?: CatHue }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className="grid gap-x-6 gap-y-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
    >
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
          <dd
            className="tele truncate"
            style={item.hue ? { color: catVar(item.hue) } : undefined}
            title={typeof item.value === "string" ? item.value : undefined}
          >
            {item.value ?? "∅"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Small mono provenance/limits line — what was measured, when, what was left out. */
export function Provenance({ children }: { children: ReactNode }) {
  return (
    <p className="tele mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{children}</p>
  );
}

export function MonoNote({ children, hue }: { children: ReactNode; hue?: CatHue }) {
  return (
    <span className="tele text-[10px]" style={hue ? { color: catVar(hue) } : undefined}>
      {children}
    </span>
  );
}

export function EmptyState({ note }: { note: string }) {
  return (
    <div className="flex items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--line-2)] px-4 py-8 text-xs text-muted-foreground">
      {note}
    </div>
  );
}

/* ── TreeView — the Project Browser shape ─────────────────────────────────── */

export type TreeNode = {
  id: string;
  label: ReactNode;
  /** tele aside on the row's right edge (counts, ids). */
  meta?: ReactNode;
  children?: TreeNode[];
  defaultOpen?: boolean;
};

/** Collapsible hairline tree, Revit Project Browser flavored: disclosure carets,
 * guide lines, quiet hover. Leaf rows read as items, group rows as folders. */
export function TreeView({ nodes, dense = false }: { nodes: TreeNode[]; dense?: boolean }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-[var(--radius)] border border-[var(--line)]">
      <ul className="py-1">
        {nodes.map((node) => (
          <TreeRow key={node.id} node={node} depth={0} dense={dense} />
        ))}
      </ul>
    </div>
  );
}

function TreeRow({ node, depth, dense }: { node: TreeNode; depth: number; dense: boolean }) {
  const [open, setOpen] = useState(node.defaultOpen ?? depth < 1);
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <li>
      <div
        role={hasChildren ? "button" : undefined}
        onClick={hasChildren ? () => setOpen(!open) : undefined}
        className={cn(
          "flex min-w-0 items-center gap-1 pr-2 hover:bg-muted/60",
          dense ? "py-px" : "py-0.5",
          hasChildren && "cursor-pointer select-none",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          className={cn(
            "inline-block w-3 shrink-0 text-center text-[9px] text-muted-foreground transition-transform duration-[120ms]",
            open && hasChildren && "rotate-90",
          )}
        >
          {hasChildren ? "▸" : ""}
        </span>
        <span
          className={cn("min-w-0 truncate text-xs", hasChildren && "font-medium")}
          title={typeof node.label === "string" ? node.label : undefined}
        >
          {node.label}
        </span>
        {node.meta && (
          <span className="tele ml-auto shrink-0 text-[10px] text-muted-foreground">
            {node.meta}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <ul
          className="border-l border-[var(--line-soft)]"
          style={{ marginLeft: 8 + depth * 14 + 5 }}
        >
          {node.children?.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} dense={dense} />
          ))}
        </ul>
      )}
    </li>
  );
}

/* ── DataTable — the Revit schedule shape ─────────────────────────────────── */

export type Column<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** numeric columns right-align and read tabular. */
  numeric?: boolean;
  width?: number | string;
};

/** Readonly grid, Revit-schedule flavored: optional centered title band, bold
 * header band, hairline gridlines, mono numerals. Data cells go square (radius 0
 * inside the 2px frame) — data surfaces may. */
export function DataTable<Row>({
  title,
  columns,
  rows,
  rowKey,
  maxHeight = "28rem",
  footer,
}: {
  title?: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  maxHeight?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius)] border border-[var(--line-2)]">
      {title && (
        <div className="border-b border-[var(--line-2)] px-2 py-1 text-center text-xs font-semibold">
          {title}
        </div>
      )}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap border-b border-r border-b-[var(--line-2)] border-r-[var(--line-soft)] px-2 py-1 font-semibold",
                    col.numeric && "text-right",
                  )}
                  style={{ width: col.width }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="hover:bg-muted/40">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-[var(--line-soft)] px-2 py-1 align-top",
                      col.numeric && "tele text-right",
                    )}
                  >
                    {col.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">no rows</div>
        )}
      </div>
      {footer && <div className="border-t border-[var(--line)] px-2 py-1">{footer}</div>}
    </div>
  );
}

/* ── CoverageBar — proportions with an honest legend ──────────────────────── */

export type CoverageSegment = { label: string; count: number; hue: CatHue };

/** Stacked proportion bar + tele legend. Weight and order carry the meaning so
 * it survives grayscale; color reinforces. */
export function CoverageBar({
  segments,
  total,
}: {
  segments: CoverageSegment[];
  /** denominator; defaults to segment sum. */
  total?: number;
}) {
  const sum = segments.reduce((acc, s) => acc + s.count, 0);
  const denom = total ?? sum;
  if (denom <= 0) return <EmptyState note="nothing in scope" />;
  return (
    <div>
      <div className="flex h-[10px] overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.count}`}
            className="border-r border-[var(--background)]"
            style={{
              width: `${(s.count / denom) * 100}%`,
              backgroundColor: `color-mix(in srgb, ${catVar(s.hue)} 55%, transparent)`,
            }}
          />
        ))}
        {sum < denom && (
          <div
            title={`unaccounted: ${denom - sum}`}
            className="bg-muted"
            style={{ width: `${((denom - sum) / denom) * 100}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map((s) => (
          <span key={s.label} className="tele inline-flex items-center gap-1 text-[10px]">
            <span
              className="inline-block size-[7px] rounded-[1px]"
              style={{ backgroundColor: catVar(s.hue) }}
            />
            <span className="text-muted-foreground">{s.label}</span> {s.count}
          </span>
        ))}
        {typeof total === "number" && (
          <span className="tele text-[10px] text-muted-foreground">of {total}</span>
        )}
      </div>
    </div>
  );
}
