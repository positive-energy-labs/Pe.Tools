/**
 * THROWAWAY (protoui round 2, E1/E2): the edit surface, a click-anchored popover off a sidebar
 * row (never a pane). It carries the element's facts when the row is one element, the losses
 * item's rule editor for the grille whose path the row lies on (table chips per rule, terminal and
 * component drops, catalog link), and the staged rules and drops with what they move.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";

import { NodeFactsView, SegmentFactsView } from "../../facts";
import type { LossesWork } from "../../losses-view";
import type { DuctIndex } from "../../scene";
import { Drawer, StagedRules } from "./rules";

export interface EditTarget {
  anchor: HTMLElement;
  title: string;
  /** The grille whose path the row lies on; its rules are what the editor stages. */
  terminal: number | null;
  /** Set only when the row is one element: its facts are drawn. */
  element: number | null;
}

export function EditPopover({
  target,
  close,
  index,
  priced,
  group,
  work,
}: {
  target: EditTarget | null;
  close: () => void;
  index: DuctIndex;
  priced: Priced | null;
  group: string;
  work: LossesWork;
}) {
  const id = target?.element ?? null;
  const segment = id == null ? null : index.snapshot.segments.find((s) => s.id === id);
  const node = id == null ? null : index.snapshot.nodes.find((n) => n.id === id);
  const issues = id == null ? [] : (index.issuesOf.get(id) ?? []);
  return (
    <Popover open={!!target} onOpenChange={(open) => (open ? null : close())}>
      <PopoverContent
        anchor={target?.anchor}
        side="right"
        align="start"
        className="max-h-[80vh] w-[min(62rem,70vw)] overflow-auto"
      >
        {target ? (
          <div className="flex flex-col gap-3" data-e-edit={target.title}>
            <p className="font-medium">{target.title}</p>
            {segment ? (
              <SegmentFactsView
                segment={segment}
                derivedCfm={index.flows.get(segment.id) ?? null}
                issues={issues}
              />
            ) : node ? (
              <NodeFactsView node={node} issues={issues} />
            ) : null}
            <section className="flex flex-col gap-1">
              <p className="t-upper t-small text-ink-2">
                rules on {target.terminal == null ? "this path" : `grille ${target.terminal}'s path`}
              </p>
              {!priced ? (
                <p className="text-ink-mute">not priced: the ASHRAE tables are not read</p>
              ) : target.terminal == null || !priced.next.paths[target.terminal] ? (
                <p className="text-ink-2">no priced grille path runs through this row</p>
              ) : (
                <Drawer
                  snapshot={index.snapshot}
                  priced={priced}
                  terminal={target.terminal}
                  work={work}
                />
              )}
            </section>
            <section className="flex flex-col gap-1">
              <p className="t-upper t-small text-ink-2">staged</p>
              {priced ? (
                <StagedRules priced={priced} group={group} work={work} />
              ) : (
                <p className="text-ink-mute">not priced</p>
              )}
            </section>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
