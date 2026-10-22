/**
 * The duct network and the write outcomes in a person's words. Plain data in, a string out: the
 * route's notes and rows, and Pea, say these the same way.
 */
import type { DuctsApply, DuctsHeal } from "@pe/host-contracts/generated";

import { markOf } from "./terminal-flows.ts";
import type { DuctSnapshot } from "./types.ts";

/**
 * Group names that tell groups apart: the system names and the root units' marks (else their
 * family); where two groups would otherwise read alike the later ones are numbered, never named
 * by a group id.
 */
export function groupLabels(snapshot: DuctSnapshot): Map<string, string> {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const base = snapshot.groups.map((group) => {
    const system = group.systemNames.slice(0, 2).join(", ") || group.classifications.join(", ");
    const roots = group.rootIds
      .map((id) => markOf(nodes.get(id)) ?? nodes.get(id)?.family ?? String(id))
      .join(", ");
    const parts = [system, group.rootIds.length ? roots : "no air mover"].filter(Boolean);
    return [group.id, parts.join(" · ")] as const;
  });
  const seen = new Map<string, number>();
  return new Map(
    base.map(([id, label]) => {
      const n = (seen.get(label) ?? 0) + 1;
      seen.set(label, n);
      return [id, n > 1 ? `${label} ${n}` : label];
    }),
  );
}

/** A duct network in a person's words: its systems and units (`groupLabels`), never its group id. */
export const networkWord = (snapshot: DuctSnapshot, group: string) =>
  groupLabels(snapshot).get(group) ?? "the duct network";

const countsWord = (counts: object, none: string) =>
  (Object.entries(counts) as [string, number][])
    .filter(([, n]) => n)
    .map(([outcome, n]) => `${n} ${outcome}`)
    .join(" · ") || none;

export const healWords = (response: DuctsHeal.Res.Response) =>
  countsWord(response.counts, "nothing to heal");

export const outcomeWords = (response: DuctsApply.Res.Response) =>
  countsWord(response.counts, "nothing to write");
