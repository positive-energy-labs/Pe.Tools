import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** Union two `from` reads of one document by element id (a walked copy wins over a candidate copy), and their health by id. */
export function mergeSnapshots(a: DuctSnapshot, b: DuctSnapshot): DuctSnapshot {
  const union = <T extends { id: number; reason?: string | null }>(
    x: readonly T[],
    y: readonly T[],
  ) => {
    const byId = new Map(x.map((e) => [e.id, e]));
    for (const e of y) {
      const have = byId.get(e.id);
      if (!have || ((have.reason ?? "walked") !== "walked" && (e.reason ?? "walked") === "walked"))
        byId.set(e.id, e);
    }
    return [...byId.values()];
  };
  return {
    ...a,
    walk: a.walk ? { ...a.walk, truncated: a.walk.truncated || !!b.walk?.truncated } : b.walk,
    nodes: union(a.nodes as never[], b.nodes as never[]) as DuctSnapshot["nodes"],
    segments: union(a.segments as never[], b.segments as never[]) as DuctSnapshot["segments"],
    // Health is model truth, measured the same way in either read; the first copy of an id stands.
    issues: [...new Map([...b.issues, ...a.issues].map((i) => [i.id, i])).values()],
  };
}
/** Native connector walks stop at gaps. Acquire the far side of accepted joins for both the
 * worksheet and its write preview; a walked copy replaces an unwalked candidate.
 * ponytail: one native read per bridged join, bounded at four rounds. Batch seeds if this gets slow.
 */
export async function followAcceptedJoins(
  snapshot: DuctSnapshot,
  rulings: readonly { pair: readonly string[]; verdict: string }[],
  read: (unitId: number) => Promise<DuctSnapshot>,
): Promise<DuctSnapshot> {
  type Walked = { id: number; reason?: string | null };
  const elementOf = (end: string) => Number(end.split(":")[0]);
  const seeded = new Set<number>();
  let merged = snapshot;
  for (let round = 0; round < 4; round += 1) {
    const walked = new Set(
      [...merged.nodes, ...merged.segments]
        .filter((e) => ((e as Walked).reason ?? "walked") === "walked")
        .map((e) => e.id),
    );
    const seeds = rulings
      .filter((r) => r.verdict === "accept")
      .flatMap((r) => {
        const [a, b] = r.pair.map(elementOf) as [number, number];
        return walked.has(a) && !walked.has(b) ? [b] : walked.has(b) && !walked.has(a) ? [a] : [];
      })
      .filter((id) => !seeded.has(id));
    if (seeds.length === 0) break;
    for (const id of seeds) {
      seeded.add(id);
      const more = await read(id);
      merged = mergeSnapshots(merged, more);
    }
  }
  return merged;
}
