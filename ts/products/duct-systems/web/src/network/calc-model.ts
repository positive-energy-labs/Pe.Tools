/** The /ducts tree, read off the fan calcs alone (spike B, landed at the phase-3 cutover). */
import type { FanPortRef } from "@pe/fans-contract/fan-calc";
import { rowOf, type Calc as Calc } from "@pe/ducts-domain/calc-runs";
import { splitOf } from "../loss-split.ts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import type { TreeNode } from "./model.ts";

export interface CalcTreeNode extends TreeNode {
  fan: FanPortRef | null;
  /** Known arithmetic is separate from a complete pressure claim. */
  knownInWg: number | null;
  blockerIds: string[];
  health: DuctSnapshot["issues"];
  message: string | null;
  children: CalcTreeNode[];
}

const legOf = (sheet: Calc, id: string) => {
  const leg = sheet.legs[id];
  if (!leg) throw Error(`Fan calc path names missing leg ${id}`);
  return leg;
};

/** A path with every leg priced and no blocker: its known loss is its whole loss. */
const wholeOf = (sheet: Calc, path: Calc["paths"][number]) =>
  !path.blockerIds.length && path.legIds.every((id) => legOf(sheet, id).lossInWg != null);

const node = (
  props: Pick<CalcTreeNode, "key" | "kind" | "name" | "id"> & Partial<CalcTreeNode>,
): CalcTreeNode => ({
  total: null,
  self: null,
  ft: null,
  selfFt: null,
  rate: null,
  unpriced: null,
  split: null,
  scale: null,
  critical: null,
  provisional: null,
  level: null,
  terminal: null,
  fan: null,
  knownInWg: null,
  blockerIds: [],
  health: [],
  message: null,
  children: [],
  ...props,
});

/**
 * All sheets must describe the same network observation and resolved design. Acquisition and
 * freshness fencing belong to the read graph, not this projection. [] means a complete empty
 * roster, never a pending or failed roster read.
 *
 * Shared paths stay under each fan, keyed by fan port + side + path index. No ownership or
 * system-wide scalar is invented. A fan's pressure is claimed only on its own full sheet.
 */
export function buildCalcTree(
  snapshot: DuctSnapshot,
  sheets: readonly Calc[],
  only: readonly string[] = [],
  members?: ReadonlySet<number>,
  sectionName?: (group: string) => string,
): CalcTreeNode[] {
  const equipment = new Set(snapshot.nodes.filter((n) => n.kind === "equipment").map((n) => n.id));
  const levelOf = (id: number) => {
    const level = snapshot.nodes.find((n) => n.id === id)?.levelId;
    return snapshot.levels.find((l) => l.id === level)?.name ?? null;
  };
  const name = elementLabeler(snapshot);
  const elements = [...snapshot.nodes, ...snapshot.segments];
  const health = (ids: ReadonlySet<number>) => snapshot.issues.filter((i) => ids.has(i.elementId));
  return snapshot.groups
    .filter((g) => !only.length || only.includes(g.id))
    .map((group) => {
      const ids = new Set(
        elements
          .filter((e) => e.groupId === group.id && (!members || members.has(e.id)))
          .map((e) => e.id),
      );
      const reached = new Set<number>();
      const fans = new Set<string>();
      const runs = sheets.flatMap((sheet) => {
        const fanKey = `${sheet.fan.unitId}:${sheet.fan.portIndex}`;
        const relevant = sheet.paths
          .map((path, index) => ({ path, index }))
          .filter(
            ({ path }) =>
              ids.has(path.end.elementId) ||
              group.rootIds.includes(path.end.elementId) ||
              path.legIds.some((id) => ids.has(legOf(sheet, id).elementId)),
          );
        if (!relevant.length && !group.rootIds.includes(sheet.fan.unitId)) return [];
        fans.add(fanKey);
        // The fan's worst whole run wears the mark; `paths` is ranked worst first per side.
        const worst = relevant
          .filter(({ path }) => wholeOf(sheet, path))
          .reduce<number | null>(
            (best, { path, index }) =>
              best == null || path.knownInWg > (sheet.paths[best]?.knownInWg ?? -Infinity)
                ? index
                : best,
            null,
          );
        const paths = relevant.map(({ path, index }) => {
          // Do not clip a path to group/system members and then label its subtotal a fan pressure.
          const key = `${group.id}/f${fanKey}/${path.side}/p${index}`;
          let known = 0;
          let knownFt = 0;
          let complete = true;
          const legs = path.legIds.map((legId) => {
            const leg = legOf(sheet, legId);
            if (ids.has(leg.elementId)) reached.add(leg.elementId);
            known += leg.lossInWg ?? 0;
            knownFt += leg.equivalentFt ?? 0;
            complete &&= leg.lossInWg != null;
            const evidence = leg.evidence;
            const blockers = sheet.blockers.filter((b) => b.elementId === leg.elementId);
            const values = {
              fan: sheet.fan,
              partial: sheet.claim.kind === "incomplete",
              self: leg.lossInWg,
              total: complete ? known : null,
              knownInWg: known,
              ft: knownFt,
              selfFt: leg.equivalentFt,
              rate:
                evidence.kind === "friction" && evidence.lengthFt > 1e-9 && (leg.lossInWg ?? 0) > 0
                  ? ((leg.lossInWg ?? 0) / evidence.lengthFt) * 100
                  : null,
              scale: sheet.totals.requiredEspInWg,
              terminal: path.end.kind === "terminal" ? path.end.elementId : null,
              health: health(new Set([leg.elementId])),
              blockerIds: blockers.map((b) => b.id),
              unpriced:
                leg.lossInWg == null
                  ? {
                      word: "unpriced",
                      why: blockers.map((b) => b.detail).join("; ") || "No priced sheet leg",
                    }
                  : null,
            };
            return node({
              key: `${key}/l${legId}`,
              kind: "leg",
              id: leg.elementId,
              name: name(leg.elementId),
              ...values,
              children: [
                node({
                  key: `${key}/l${legId}/e${leg.elementId}`,
                  kind: "element",
                  id: leg.elementId,
                  name: name(leg.elementId),
                  ...values,
                }),
              ],
            });
          });
          const pathIds = new Set(path.legIds.map((id) => legOf(sheet, id).elementId));
          return node({
            key,
            kind: "run",
            id: path.end.elementId,
            name: `${sheet.fan.mark} ${path.side} \u2192 ${name(path.end.elementId)}`,
            fan: sheet.fan,
            total: wholeOf(sheet, path) ? path.knownInWg : null,
            knownInWg: path.knownInWg,
            partial: sheet.claim.kind === "incomplete",
            ft: knownFt,
            split: splitOf(
              snapshot,
              path.legIds.map((id) => rowOf(legOf(sheet, id), sheet)),
              equipment,
            ),
            critical: index === worst ? "pe" : null,
            level: path.end.kind === "terminal" ? levelOf(path.end.elementId) : null,
            scale: sheet.totals.requiredEspInWg,
            terminal: path.end.kind === "terminal" ? path.end.elementId : null,
            blockerIds: path.blockerIds,
            health: health(pathIds),
            message: wholeOf(sheet, path) ? null : "Incomplete path; known loss is a subtotal",
            children: legs,
          });
        });
        return [
          node({
            key: `${group.id}/f${fanKey}`,
            kind: "system",
            id: sheet.fan.unitId,
            name: `${sheet.fan.mark} (full fan sheet)`,
            fan: sheet.fan,
            total: sheet.totals.requiredEspInWg,
            scale: sheet.totals.requiredEspInWg,
            blockerIds: sheet.blockers.map((b) => b.id),
            message:
              "Fan pressure includes both sides and allowances, beyond this network if needed",
            children: paths,
          }),
        ];
      });
      // Even a fanless network and branches no sheet reaches remain inspectable and healable.
      const unwalked = [...ids]
        .filter((id) => !reached.has(id))
        .map((id) =>
          node({
            key: `${group.id}/unwalked/e${id}`,
            kind: "element",
            id,
            name: name(id),
            health: health(new Set([id])),
          }),
        );
      return node({
        key: group.id,
        kind: "system",
        id: group.rootIds[0] ?? [...ids][0] ?? null,
        name: sectionName?.(group.id) ?? (group.systemNames.join(", ") || group.id),
        health: health(ids),
        message: !fans.size
          ? "Rule a fan to price this system"
          : fans.size > 1
            ? "Shared network; read pressure per fan"
            : null,
        // A group is a navigation scope. Both supply and return can cross its boundary.
        children: [
          ...runs,
          ...(unwalked.length
            ? [
                node({
                  key: `${group.id}/unwalked`,
                  kind: "leg",
                  id: unwalked[0]?.id ?? null,
                  name: "Ducts and parts outside fan paths",
                  children: unwalked,
                }),
              ]
            : []),
        ],
      });
    });
}

/** Every run row of these trees: a group's fan calcs sit between it and their runs. */
export const runNodesOf = (trees: readonly TreeNode[]): TreeNode[] =>
  trees.flatMap((tree) =>
    tree.children.flatMap((fan) => fan.children.filter((n) => n.kind === "run")),
  );
