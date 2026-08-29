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
      className="inline-flex items-center gap-1 px-1.5 py-px"
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
          <dt className="">{item.label}</dt>
          <dd
            className="truncate"
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
    <div className="max-h-[32rem] overflow-auto">
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
          "flex min-w-0 items-center gap-1 pr-2",
          dense ? "py-px" : "py-0.5",
          hasChildren && "cursor-pointer select-none",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          className={cn(
            "inline-block w-3 shrink-0 text-center transition-transform duration-control",
            open && hasChildren && "rotate-90",
          )}
        >
          {hasChildren ? "▸" : ""}
        </span>
        <span
          className={cn("min-w-0 truncate", hasChildren && "")}
          title={typeof node.label === "string" ? node.label : undefined}
        >
          {node.label}
        </span>
        {node.meta && <span className="ml-auto shrink-0">{node.meta}</span>}
      </div>
      {hasChildren && open && (
        <ul className="" style={{ marginLeft: 8 + depth * 14 + 5 }}>
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
    <div className="min-w-0">
      {title && <div className="px-2 py-1 text-center">{title}</div>}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full text-left">
          <thead className="sticky top-0 z-sticky" style={RECESS_GROUND}>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn("whitespace-nowrap px-2 py-1", col.numeric && "text-right")}
                  style={{ width: col.width }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1 align-top",
                      col.numeric && "text-right",
                    )}
                  >
                    {col.cell(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="px-2 py-6 text-center">no rows</div>}
      </div>
      {footer && <div className="px-2 py-1">{footer}</div>}
    </div>
  );
}
