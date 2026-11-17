/**
 * What a fan's claim may believe about how much of its network was read (RULES 2026-11-16 18:00).
 * `coverageOf` is the only reader of a snapshot's optional `walk` and `reach`: every source comes
 * out `read` or `lost`, and a source it cannot account for is `lost`. Only `wholeCoverage` makes
 * the value a `complete` claim is built from.
 */
import type { CoverageGap } from "@pe/agent-contracts";
import type { DuctSnapshot } from "../types.ts";

type Peer = { elementId: number; connector: number };
type Source = "walk" | "reach";
export type SourceCoverage =
  /** The source answered. `peers` are its unread peers that sit in another fan's scope. */
  | { kind: "read"; source: Source; peers: readonly Peer[] }
  | {
      kind: "lost";
      source: Source | "snapshot";
      reason: "absent" | "truncated" | "incomplete" | "peer" | "seed" | "unplaced";
      elementId: number | null;
      ref: string;
    };
export type Coverage = readonly SourceCoverage[];

declare const WHOLE: unique symbol;
/** Coverage with no `lost` entry. `wholeCoverage` is its only source; a cast is the health ratchet's to catch. */
export type WholeCoverage = readonly Extract<SourceCoverage, { kind: "read" }>[] & {
  readonly [WHOLE]: true;
};
const isWhole = (c: Coverage): c is WholeCoverage =>
  c.length > 0 && c.every((s) => s.kind === "read");
export const wholeCoverage = (c: Coverage): WholeCoverage | null => (isWhole(c) ? c : null);

export type CoverageEvidence = Pick<DuctSnapshot, "nodes" | "segments"> &
  Partial<Pick<DuctSnapshot, "walk" | "reach">>;

/**
 * One fan's coverage of one snapshot. `walked` is the fan's scope: the elements its own walk took.
 * An unread peer is another fan's only when it names an element the snapshot holds and this fan did
 * not walk. A system seed (`connector` -1, DuctSnapshots.cs) names no element, so no fan can disown it.
 */
export function coverageOf(snapshot: CoverageEvidence, walked: ReadonlySet<number>): Coverage {
  const held = new Set([...snapshot.nodes, ...snapshot.segments].map((e) => e.id));
  const lost = (
    source: Source | "snapshot",
    reason: Extract<SourceCoverage, { kind: "lost" }>["reason"],
    elementId: number | null,
    ref: string,
  ): SourceCoverage => ({ kind: "lost", source, reason, elementId, ref });
  const source = (
    name: Source,
    peers: readonly Peer[],
    failed: "truncated" | "incomplete" | null,
  ): SourceCoverage[] => {
    // A source from before the native read listed unread peers cannot say which peers it read.
    if (!Array.isArray(peers)) return [lost(name, "absent", null, `the native ${name} lists no unread peers`)];
    const entries = peers.flatMap((p) =>
      p.connector < 0
        ? [lost(name, "seed", null, `system ${p.elementId} seed read failed`)]
        : walked.has(p.elementId)
          ? [lost(name, "peer", p.elementId, `${p.elementId}:${p.connector}`)]
          : held.has(p.elementId)
            ? []
            : [lost(name, "unplaced", null, `${p.elementId}:${p.connector} is on no element this read holds`)],
    );
    // A truncated walk is lost whatever it names; an incomplete reach is explained only by a peer it names.
    if (failed === "truncated" || (failed && peers.length === 0))
      entries.push(lost(name, failed, null, `the native ${name} is ${failed}`));
    return entries.length ? entries : [{ kind: "read", source: name, peers }];
  };
  const { walk, reach } = snapshot;
  if (walk == null && reach == null)
    return [lost("snapshot", "absent", null, "coverage unread: the snapshot carries no walk and no reach")];
  return [
    ...(walk == null ? [] : source("walk", walk.unreadPeers, walk.truncated ? "truncated" : null)),
    ...(reach == null ? [] : source("reach", reach.unreadPeers, reach.complete ? null : "incomplete")),
  ];
}

/** Every `lost` entry as the claim's wire gap. */
export const coverageGaps = (c: Coverage): CoverageGap[] =>
  c.flatMap((s) =>
    s.kind === "lost"
      ? [{ kind: s.reason === "truncated" ? "budget" : "native-peer", elementId: s.elementId, ref: s.ref }]
      : [],
  );
