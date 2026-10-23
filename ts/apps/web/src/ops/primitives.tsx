import { token } from "@pe/kit/lib/token";
import type { ReactNode } from "react";
import { useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { TooltipHint } from "@pe/kit/lang/tooltip";

export type VizIndex = 1 | 2 | 3 | 4 | 5 | 6;

/** A data-series hue (charts and bars only: I3, colour carries a series, never a plain category). */
export function vizVar(viz: VizIndex): string {
  return token(`viz-${viz}`);
}

type KVTone = "caution";

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
          <TooltipHint content={typeof item.value === "string" ? item.value : undefined}>
            <dd className="truncate" style={item.tone ? { color: KV_TONE[item.tone] } : undefined}>
              {item.value ?? "∅"}
            </dd>
          </TooltipHint>
        </div>
      ))}
    </dl>
  );
}

export type TreeNode = {
  id: string;
  label: string;
  meta?: ReactNode;
  children?: TreeNode[];
  defaultOpen?: boolean;
  /** A leaf that stands for Revit elements answers right-click with Selection Box and Select (N4). */
  revitIds?: readonly number[];
};

const childrenOf = (node: TreeNode) => node.children ?? [];
const searchOf = (node: TreeNode) => ({ text: [node.label], ids: node.revitIds });
const opened = (nodes: readonly TreeNode[], depth = 0): string[] =>
  nodes.flatMap((node) => [
    ...((node.defaultOpen ?? depth < 1) && node.children?.length ? [node.id] : []),
    ...opened(node.children ?? [], depth + 1),
  ]);

/** An op's tree as the one list (N3): keyboard, "/" search, sticky virtual rows. */
export function TreeView({ nodes, label }: { nodes: TreeNode[]; label: string }) {
  const list = useList({
    items: nodes,
    keyOf: (node) => node.id,
    search: searchOf,
    tree: { childrenOf },
    initialState: { open: opened(nodes) },
  });
  return (
    <ListView
      list={list}
      aria-label={label}
      maxHeight="32rem"
      empty={{ message: `no ${label}`, exit: "run the operation on a richer document" }}
      row={(node) => ({ label: node.label, meta: node.meta, revitIds: node.revitIds })}
    />
  );
}
