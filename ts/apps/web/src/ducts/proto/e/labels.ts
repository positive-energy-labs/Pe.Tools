/**
 * THROWAWAY (protoui round 3, E2): a person's name for each grille a sidebar lists, never its id.
 * The node's label, else its type (else family), plus a short place: its level when the snapshot
 * gives one. Grilles that would read the same take the leg nearest each grille that the others'
 * runs do not share ("via <where it starts>"); any still the same take an ordinal, never an id.
 */
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { typeName } from "../../claims";
import type { TreeNode } from "../b/model";

export function grilleLabels(snapshot: DuctSnapshot, runs: readonly TreeNode[]): Map<number, string> {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const levels = new Map(snapshot.levels.map((l) => [l.id, l.name]));
  const base = new Map<number, string>();
  const legsOf = new Map<number, string[]>();
  for (const run of runs) {
    if (run.terminal == null) continue;
    const node = nodes.get(run.terminal);
    const name = node?.label || (node ? typeName(node) : "") || "grille";
    const level = node?.levelId != null ? levels.get(node.levelId) : undefined;
    base.set(run.terminal, level ? `${name} · ${level}` : name);
    legsOf.set(run.terminal, run.children.map((leg) => leg.name));
  }
  const count = (m: Map<number, string>) => {
    const c = new Map<string, number>();
    for (const v of m.values()) c.set(v, (c.get(v) ?? 0) + 1);
    return c;
  };
  const first = count(base);
  /** The leg nearest the grille that no other grille of the same name walks. */
  const ownLeg = (id: number, name: string) => {
    const others = [...base].filter(([o, n]) => o !== id && n === name).flatMap(([o]) => legsOf.get(o) ?? []);
    const leg = [...(legsOf.get(id) ?? [])].reverse().find((l) => !others.includes(l));
    return leg ? (leg.split(" → ")[0] ?? leg) : null;
  };
  const withLeg = new Map(
    [...base].map(([id, name]) => {
      const leg = (first.get(name) ?? 0) > 1 ? ownLeg(id, name) : null;
      return [id, leg ? `${name} · via ${leg}` : name];
    }),
  );
  const second = count(withLeg);
  const seen = new Map<string, number>();
  return new Map(
    [...withLeg].map(([id, name]) => {
      if ((second.get(name) ?? 0) < 2) return [id, name];
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      return [id, `${name} (${n})`];
    }),
  );
}
