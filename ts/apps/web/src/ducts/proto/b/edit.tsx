/**
 * THROWAWAY (protoui round 1, variant B): the click-anchored edit popover over one tree row: the
 * element's facts (facts.tsx), its priced rows on this run, and the assumption editor for each
 * issue that names it. Never opened by hover.
 */
import type { DuctsRouteDocument, RouteStatePatch } from "@pe/agent-contracts";
import type { Priced } from "@pe/ducts-domain/pricing";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";

import { AssumptionCell } from "../../assumptions";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import type { DuctIndex } from "../../scene";
import type { TreeNode } from "./model";

export function EditPopover({
  target,
  close,
  index,
  priced,
  work,
}: {
  target: { node: TreeNode; anchor: HTMLElement } | null;
  close: () => void;
  index: DuctIndex;
  priced: Priced | null;
  work: { doc: DuctsRouteDocument | null; write: (patch: RouteStatePatch[]) => Promise<unknown> };
}) {
  const node = target?.node;
  const id = node?.id ?? null;
  const segment = id == null ? null : index.snapshot.segments.find((s) => s.id === id);
  const duct = id == null ? null : index.snapshot.nodes.find((n) => n.id === id);
  const issues = id == null ? [] : (index.issuesOf.get(id) ?? []);
  const rows =
    id != null && node?.terminal != null
      ? (priced?.now.paths[node.terminal]?.rows.filter((r) => r.id === id) ?? null)
      : null;
  return (
    <Popover open={!!target} onOpenChange={(open) => (open ? null : close())}>
      <PopoverContent anchor={target?.anchor} side="right" align="start" className="w-96">
        {node ? (
          <div className="flex flex-col gap-2" data-proto-b-edit={node.key}>
            <p className="font-medium">
              {node.kind}: {node.name}
            </p>
            {node.kind !== "element" ? (
              <p className="text-ink-2">
                facts below are for{" "}
                {node.kind === "run"
                  ? "its terminal"
                  : node.kind === "leg"
                    ? "its first element"
                    : "its root"}
              </p>
            ) : null}
            {segment ? (
              <SegmentFactsView
                segment={segment}
                derivedCfm={index.flows.get(segment.id) ?? null}
                issues={issues}
              />
            ) : duct ? (
              <NodeFactsView node={duct} issues={issues} />
            ) : (
              <p className="text-ink-2">no element facts</p>
            )}
            <div>
              <p className="text-ink-2 t-upper">Pe loss rows on this run</p>
              {rows == null ? (
                <p className="text-ink-mute">not priced: the ASHRAE tables are not read</p>
              ) : rows.length === 0 ? (
                <p className="text-ink-2">no row prices this element</p>
              ) : (
                rows.map((r, i) => (
                  <p key={i}>
                    <span className="face-mono">{r.dp == null ? "—" : r.dp.toFixed(4)}</span>{" "}
                    {r.kind}
                    {r.rule ? ` · ${r.rule}` : ""}
                    {r.table ? ` · ${r.table}` : ""} <span className="text-ink-2">{r.desc}</span>
                    {r.error ? <span data-tone="alarm"> {r.error}</span> : null}
                  </p>
                ))
              )}
            </div>
            {issues.length ? (
              <div className="flex flex-col gap-1">
                <p className="text-ink-2 t-upper">rulings on this element</p>
                {issues.map((issue) => (
                  <div key={issue.id} className="flex flex-col">
                    <span>{issue.note}</span>
                    <AssumptionCell issue={issue} work={work} />
                  </div>
                ))}
              </div>
            ) : null}
            <p className="text-ink-mute t-small">
              rule editor (table choice per rule) not mounted: losses-view owns it, unexported
            </p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
