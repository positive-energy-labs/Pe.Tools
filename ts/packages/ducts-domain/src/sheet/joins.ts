import { mergeSnapshots } from "../system-reads.ts";
import type { DuctSnapshot } from "../types.ts";

type Walked = { id: number; reason?: string | null };
const walked = (e: Walked) => (e.reason ?? "walked") === "walked";

/**
 * The far side of one accepted join, merged under the near read. The near read stands (its document,
 * store, cohorts and walk identity), and both reads' coverage is kept. An element the near read holds
 * only as an unwalked candidate gives way to the far read's walked copy.
 */
export function mergeFar(near: DuctSnapshot, far: DuctSnapshot): DuctSnapshot {
  const farWalked = new Set([...far.nodes, ...far.segments].filter(walked).map((e) => e.id));
  const keep = <T extends Walked>(items: readonly T[]) =>
    items.filter((e) => walked(e) || !farWalked.has(e.id));
  const held = { ...near, nodes: keep(near.nodes), segments: keep(near.segments) } as DuctSnapshot;
  // Later parts win in the list merge, so the near read goes last. The write mint checks a cohort's
  // basis against `document.readAt`, so the near read's document stands with its cohorts.
  return { ...mergeSnapshots([far, held])!, document: near.document };
}

/**
 * Native connector walks stop at gaps. Acquire the far side of accepted joins for both the
 * worksheet and its write preview.
 * ponytail: one native read per bridged join, bounded at four rounds. Batch seeds if this gets slow.
 */
export async function followAcceptedJoins(
  snapshot: DuctSnapshot,
  rulings: readonly { pair: readonly string[]; verdict: string }[],
  read: (unitId: number) => Promise<DuctSnapshot>,
): Promise<DuctSnapshot> {
  const elementOf = (end: string) => Number(end.split(":")[0]);
  const seeded = new Set<number>();
  let merged = snapshot;
  for (let round = 0; round < 4; round += 1) {
    const here = new Set([...merged.nodes, ...merged.segments].filter(walked).map((e) => e.id));
    const seeds = rulings
      .filter((r) => r.verdict === "accept")
      .flatMap((r) => {
        const [a, b] = r.pair.map(elementOf) as [number, number];
        return here.has(a) && !here.has(b) ? [b] : here.has(b) && !here.has(a) ? [a] : [];
      })
      .filter((id) => !seeded.has(id));
    if (seeds.length === 0) break;
    for (const id of seeds) {
      seeded.add(id);
      merged = mergeFar(merged, await read(id));
    }
  }
  return merged;
}
