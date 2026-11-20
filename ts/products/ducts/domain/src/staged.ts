/** What the Work has edit for a write, counted from the document alone. */
import { workElementId } from "./work-subject.ts";
import { decode } from "@pe/agent-contracts";
import { fanBindingRows } from "@pe/fans-contract/fans-inputs";
import type { DuctsApplyInput, DuctsDesign } from "@pe/duct-systems-contract/ducts";
import type { WorkPath } from "@pe/agent-contracts";
import type { FansDocument } from "@pe/fans-contract/fans";
import type { DuctsApply } from "@pe/host-contracts/generated";

import { pendingRulings } from "./rulings.ts";
import type { DuctSnapshot } from "./types.ts";

type Segment = "terminalDrops" | "componentDrops" | "flows" | "equipmentFlows" | "roles";
/** The Fans Work segments apply carries, from the one inputs table. Rated ESP is read only. */
const WRITTEN_SEGMENTS: Record<Segment, true> = {
  terminalDrops: true,
  componentDrops: true,
  flows: true,
  equipmentFlows: true,
  roles: true,
};
const isSegment = (segment: string | null): segment is Segment =>
  segment != null && segment in WRITTEN_SEGMENTS;
const SEGMENTS = fanBindingRows().flatMap((row) =>
  row.owner === "fans" && isSegment(row.segment) ? [row.segment] : [],
);

/**
 * Fan targets are a projection of current edits, never a list frozen when scope was chosen. The walk
 * clips every segment. Required ESP has no Work cell; its native cohort belongs to the write mint.
 */
export function fanWriteCells(
  doc: FansDocument | null,
  snapshot: Pick<DuctSnapshot, "nodes" | "segments">,
) {
  const here = new Set(
    [...snapshot.nodes, ...snapshot.segments].map((element) => element.uniqueId),
  );
  return SEGMENTS.flatMap((segment) =>
    Object.entries(doc?.[segment] ?? {}).flatMap(([id, cell]) => {
      const ref = decode(id);
      return cell.edit != null &&
        ref.ok &&
        ref.value.keyKind === "UniqueId" &&
        here.has(ref.value.key)
        ? [[segment, id] as const]
        : [];
    }),
  );
}

/**
 * The staged segments the /duct-systems pending count names. A /fans apply writes the Fans Work segments and a
 * scoped rule's fitting coefficients to elements, and roles to the store; `rules` tables and `assumptions`
 * verdicts stay staged in /duct-systems Work until that route's own apply stores them (D9, `rulingsRequest`).
 */
const WRITTEN = ["rules", "terminalDrops", "componentDrops", "flows", "equipmentFlows"] as const;

const stagedCells = (doc: DuctsDesign | null) =>
  ([...WRITTEN, "catalogs", "ruleAssignments"] as const).flatMap((segment) =>
    Object.entries(doc?.[segment] ?? {}).flatMap(([key, cell]) =>
      cell?.edit ? [{ segment, key, cell }] : [],
    ),
  );

/** How many changes a write would carry: edit cells, and rulings that differ from the store's. */
export const pendingCount = (
  doc: DuctsDesign | null,
  store: DuctSnapshot["store"],
  snapshot: Pick<DuctSnapshot, "nodes" | "segments">,
) => stagedCells(doc).length + pendingRulings(doc, store, snapshot).length;

/** Retire only Fans Work cells whose transmitted native writes succeeded; held and refused cells stay edit. No /duct-systems cell is retired here (D9). */
export function appliedCellPaths(
  input: DuctsApplyInput,
  response: DuctsApply.Res.Response,
  subjects: Readonly<Record<string, string>>,
  cells: readonly (readonly [string, string])[],
): WorkPath[] {
  if (response.previewOnly) return [];
  const succeeded = response.writes.filter(
    (write) => write.outcome === "written" || write.outcome === "unchanged",
  );
  const has = (kind: string, id: number) =>
    succeeded.some((write) => write.kind === kind && write.id === id);
  const paths: WorkPath[] = [];
  for (const [rows, kind, segment] of [
    [input.terminals, "terminal", "terminalDrops"],
    [input.components, "component", "componentDrops"],
    [input.terminalFlows, "terminal-flow", "flows"],
    [input.equipmentFlows, "equipment-flow", "equipmentFlows"],
  ] as const)
    for (const row of rows)
      if (has(kind, row.id))
        paths.push(
          ...cells.filter(([s, key]) => s === segment && subjects[key] === String(row.id)),
        );
  for (const [segment, key] of cells) {
    if (segment !== "roles") continue;
    const ref = decode(key);
    if (
      ref.ok &&
      ref.value.keyKind === "UniqueId" &&
      succeeded.some((write) => write.kind === "role" && write.uniqueId === ref.value.key)
    )
      paths.push([segment, key]);
  }
  return paths;
}

/** Explicit cell scope limits both native writes and the provenance delta sent with them. */
export function scopeApplyRequest(
  request: DuctsApplyInput,
  store: DuctSnapshot["store"],
  cells: readonly (readonly [string, string])[],
  snapshot: Pick<DuctSnapshot, "nodes" | "segments">,
  fittingRules: ReadonlyMap<number, string>,
): DuctsApplyInput {
  const has = (segment: string, key: string | number) =>
    cells.some(
      ([s, k]) => s === segment && (s === "rules" ? k === key : workElementId(snapshot, k) === key),
    );
  const fittings = request.fittings.filter((row) => {
    const rule = fittingRules.get(row.id);
    return rule != null && has("rules", rule);
  });
  const terminals = request.terminals.filter((row) => has("terminalDrops", row.id));
  const components = request.components.filter((row) => has("componentDrops", row.id));
  const equipment = request.equipment;
  const terminalFlows = request.terminalFlows.filter((row) => has("flows", row.id));
  const equipmentFlows = request.equipmentFlows.filter((row) => has("equipmentFlows", row.id));
  const uniqueIds = new Map(
    [...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e.uniqueId]),
  );
  const merge = (
    key: "instances" | "terminals" | "terminalFlows" | "equipmentFlows",
    ids: readonly number[],
  ) => ({
    ...store?.[key],
    ...Object.fromEntries(
      Object.entries(request.store?.[key] ?? {}).filter(([key]) =>
        ids.some((id) => uniqueIds.get(id) === key),
      ),
    ),
  });
  const roleKeys = new Set(
    cells.flatMap(([segment, key]) =>
      segment === "roles" ? [uniqueIds.get(workElementId(snapshot, key))] : [],
    ),
  );
  return {
    ...request,
    fittings,
    terminals,
    components,
    equipment,
    terminalFlows,
    equipmentFlows,
    store: {
      version: 3,
      workRevision: store?.workRevision ?? 0,
      appliedAt: request.store?.appliedAt,
      instances: merge(
        "instances",
        fittings.map((row) => row.id),
      ),
      terminals: merge(
        "terminals",
        [...terminals, ...components].map((row) => row.id),
      ),
      terminalFlows: merge(
        "terminalFlows",
        terminalFlows.map((row) => row.id),
      ),
      equipmentFlows: merge(
        "equipmentFlows",
        equipmentFlows.map((row) => row.id),
      ),
      roles: {
        ...store?.roles,
        ...Object.fromEntries(
          Object.entries(request.store?.roles ?? {}).filter(([id]) => roleKeys.has(id)),
        ),
      },
    },
    storeDeletes: {
      ...request.storeDeletes,
      roles: request.storeDeletes?.roles?.filter((id) => roleKeys.has(id)),
    },
  };
}
