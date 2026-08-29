import { token } from "#/lib/token";
import { type CSSProperties, type ReactNode, useState } from "react";
import { cn } from "#/lib/utils";

export type VizIndex = 1 | 2 | 3 | 4 | 5 | 6;

export function vizVar(viz: VizIndex): string {
  return token(`viz-${viz}`);
}

export function VizChip({
  viz,
  children,
  title,
}: {
  viz: VizIndex;
  children: ReactNode;
  title?: string;
}) {
  const c = vizVar(viz);
  return (
    <span
      title={title}
      className="face-mono t-caption inline-flex items-center gap-1 rounded-sm border px-1.5 py-px"
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

export type KVTone = "caution";

const KV_TONE: Record<KVTone, string> = {
  caution: token("caution"),
};

export function KVGrid({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; tone?: KVTone }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className="grid gap-x-6 gap-y-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
    >
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="t-label text-ink-2">{item.label}</dt>
          <dd
            className="face-mono t-value truncate"
            style={item.tone ? { color: KV_TONE[item.tone] } : undefined}
            title={typeof item.value === "string" ? item.value : undefined}
          >
            {item.value ?? "∅"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type TreeNode = {
  id: string;
  label: ReactNode;
  meta?: ReactNode;
  children?: TreeNode[];
  defaultOpen?: boolean;
};

export function TreeView({ nodes, dense = false }: { nodes: TreeNode[]; dense?: boolean }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-sm border border-line">
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
          "flex min-w-0 items-center gap-1 pr-2 hover:veil",
          dense ? "py-px" : "py-0.5",
          hasChildren && "cursor-pointer select-none",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          className={cn(
            "t-caption inline-block w-3 shrink-0 text-center text-ink-2 transition-transform duration-control",
            open && hasChildren && "rotate-90",
          )}
        >
          {hasChildren ? "▸" : ""}
        </span>
        <span
          className={cn("t-value min-w-0 truncate", hasChildren && "font-medium")}
          title={typeof node.label === "string" ? node.label : undefined}
        >
          {node.label}
        </span>
        {node.meta && (
          <span className="face-mono t-caption ml-auto shrink-0 text-ink-2">{node.meta}</span>
        )}
      </div>
      {hasChildren && open && (
        <ul className="border-l border-line" style={{ marginLeft: 8 + depth * 14 + 5 }}>
          {node.children?.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} dense={dense} />
          ))}
        </ul>
      )}
    </li>
  );
}

export type Column<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  numeric?: boolean;
  width?: number | string;
};

const RECESS_GROUND = {
  backgroundColor: token("recess"),
  "--pe-on": token("recess"),
} as CSSProperties;

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
    <div className="min-w-0 rounded-sm border border-line-2">
      {title && (
        <div className="t-label t-upper border-b border-line-2 px-2 py-1 text-center">{title}</div>
      )}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="t-value w-full border-collapse text-left">
          <thead className="sticky top-0 z-sticky" style={RECESS_GROUND}>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "t-label t-upper whitespace-nowrap border-b border-r border-b-line-2 border-r-line px-2 py-1",
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
              <tr key={rowKey(row, index)} className="hover:veil">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-line px-2 py-1 align-top",
                      col.numeric && "face-mono t-value text-right",
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
          <div className="t-label px-2 py-6 text-center italic text-ink-mute">no rows</div>
        )}
      </div>
      {footer && <div className="border-t border-line px-2 py-1">{footer}</div>}
    </div>
  );
}
