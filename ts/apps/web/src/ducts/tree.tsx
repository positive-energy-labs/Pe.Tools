/**
 * The `tree` view body: the whole-body wrapper over `Schematic` (`schematic.tsx`). It lives only
 * until the shell cut removes the `tree` view from `route.tsx`; then this file and its test in
 * `topology.test.tsx` are deleted. The picture itself is the `Schematic`, shared with the swap.
 */
import { useMemo } from "react";

import { EmptyState } from "@pe/kit/lang/empty";
import { Pane } from "#/components/lang/pane";
import { groupTree } from "@pe/ducts-domain/topology";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { encodingOf } from "./encoding";
import { IssueLegend } from "./issues";
import type { DuctsPage } from "./manifest";
import { Schematic } from "./schematic";
import { indexOf } from "./scene";

export { layoutTree } from "./schematic";

export function DuctsTree({
  snapshot,
  page,
  setPage,
  empty,
}: {
  snapshot: DuctSnapshot | null;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  empty: { says: string; exit: string } | null;
}) {
  const index = useMemo(() => (snapshot ? indexOf(snapshot) : null), [snapshot]);
  const tree = useMemo(
    () => (snapshot && page.group ? groupTree(snapshot, page.group) : null),
    [snapshot, page.group],
  );
  const selected = useMemo(
    () => new Set(page.selected ? [Number(page.selected)] : []),
    [page.selected],
  );
  const lit = useMemo(() => new Set(tree?.longest ?? []), [tree]);

  if (empty || !index || !tree)
    return (
      <Pane id="content" title="tree">
        <EmptyState story="scope" exit={empty?.exit ?? "choose a group in the sentence"}>
          {empty?.says ?? "no group chosen: the tree draws one group"}
        </EmptyState>
      </Pane>
    );

  const longestFt = tree.longest.length ? tree.dist.get(tree.longest.at(-1)!)! : null;
  const flowed = tree.terminals.length > 0;
  return (
    <Pane
      id="content"
      title="tree"
      meta={`${tree.groupId} · ${tree.terminals.length} terminals`}
      scroll="clip"
      flush
    >
      <div className="flex size-full min-h-0 flex-col">
        <div className="flex flex-col gap-1 px-2 py-1 t-small">
          <span data-tone={tree.rooted === "stand-in" ? "caution" : undefined}>
            {tree.rootWord}.
          </span>
          <span className="text-ink-2">
            {flowed ? "" : "This group has no terminal. "}
            {longestFt != null
              ? `The lit run is the longest developed length, ${longestFt.toFixed(1)} ft of straight duct: the stand-in for the critical path until a loss solver adds fitting losses.`
              : "No terminal is reached from the root, so there is no longest run."}
          </span>
          <IssueLegend />
        </div>
        <div className="min-h-0 flex-1">
          <Schematic
            index={index}
            group={page.group}
            encoding={encodingOf(page.encoding)}
            selected={selected}
            lit={lit}
            onSelect={(id) => setPage({ selected: id == null ? "" : String(id), issue: "" })}
            onHover={() => undefined}
          />
        </div>
      </div>
    </Pane>
  );
}
