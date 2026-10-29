/**
 * Join candidates for one open connector, read from the snapshot's model health (ducts LEDGER
 * 2026-10-29: C# owns model health). The C# producer (`DuctHealth.cs`) measures each open end's
 * neighbourhood once, under the read's tolerances (`snapshot.tolerances`: the candidate box and the
 * auto-join gap, one home); this module only reads those measurements and applies a person's
 * rulings and the walk's air class. Nothing here measures geometry.
 */
import type { DuctSnapshot } from "../types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
export type Element = Node | Segment;
export type Near = NonNullable<DuctSnapshot["issues"][number]["near"]>;

export const connectorKey = (id: number, index: number) => `${id}:${index}`;
/** An air classification as connectors spell it (`SupplyAir`); null when none or undefined. */
export const classOf = (v: string | null | undefined) => {
  const c = v?.replace(/\s+/g, "");
  return c && !c.startsWith("Undefined") ? c : null;
};
/** A duct's air class: its first classified connector, else its own. */
export const segmentClass = (s: Segment) =>
  s.connectors.map((c) => classOf(c.classification)).find((c) => c != null) ??
  classOf(s.classification);

/** Each open end's neighbourhood by connector key, from the snapshot's `open-end` health records. */
export function nearOf(issues: DuctSnapshot["issues"] | undefined): Map<string, Near> {
  const out = new Map<string, Near>();
  for (const i of issues ?? [])
    if (i.kind === "open-end" && i.connector != null && i.near)
      out.set(connectorKey(i.elementId, i.connector), i.near);
  return out;
}

/**
 * One way an open connector could join. `end-to-end`: another open connector within the
 * candidate box. `collar`: landing on another open connector's mouth. `tap`: landing on a duct's
 * side or an end a cap closes, at `atFt` along it. `pair` is the stable identity a ruling keys on:
 * both connector keys for end-to-end and collar, the connector key and the duct id for a tap.
 */
export interface JoinCandidate {
  from: string;
  toElement: number;
  /** The connector landed on; null for a tap into a duct body. */
  toConnector: number | null;
  kind: "end-to-end" | "collar" | "tap";
  pair: [string, string];
  gapIn: number;
  /** cos between the two outward axes (end-to-end, collar) or the axis and a capped end's normal (tap); null without an axis. */
  facingDot: number | null;
  /** Whether the two sides state different air classifications; such a join needs an accept ruling. */
  crossing: boolean;
  /** C#'s measure: the outward axes are opposed. */
  opposed: boolean;
  /** C#'s near miss: vacant, opposed and within the read's auto-join gap. */
  autoJoin: boolean;
  atFt?: number;
  point?: number[];
  /** Set by `applyConnectorPairRulings`: a person accepted it. */
  ruled?: boolean;
}

const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const differ = (a: string | null, b: string | null) => a != null && b != null && a !== b;
const port = (g: ReadonlyMap<number, Element>, id: number, index: number | null | undefined) =>
  index == null ? undefined : g.get(id)?.connectors.find((c) => c.index === index);

/**
 * Join candidates for the open end `from` (air class `cls`) among the measured neighbourhood, in
 * elements the graph holds (a read cannot walk into what it did not read): open connectors in the
 * box, then landings on faces; nearest first. Nothing is joined.
 */
export function candidatesOf(
  from: { k: string; id: number; index: number; cls: string | null },
  near: Near | undefined,
  g: ReadonlyMap<number, Element>,
): JoinCandidate[] {
  const out: JoinCandidate[] = [];
  for (const p of near?.ports ?? []) {
    const c = port(g, p.elementId, p.connector);
    if (!c || c.connectedTo || c.point.length !== 3) continue;
    const k = connectorKey(p.elementId, p.connector);
    const [a, b] =
      from.id < p.elementId || (from.id === p.elementId && from.index < p.connector)
        ? [from.k, k]
        : [k, from.k];
    out.push({
      from: from.k,
      toElement: p.elementId,
      toConnector: p.connector,
      kind: "end-to-end",
      pair: [a, b],
      gapIn: p.gapIn,
      facingDot: p.facingDot ?? null,
      crossing: differ(from.cls, classOf(c.classification)),
      opposed: p.opposed,
      autoJoin: p.autoJoin,
    });
  }
  for (const f of near?.faces ?? []) {
    const target = g.get(f.elementId);
    if (!target) continue;
    if (f.kind === "collar") {
      const c = port(g, f.elementId, f.connector);
      if (!c) continue;
      out.push({
        from: from.k,
        toElement: f.elementId,
        toConnector: f.connector!,
        kind: "collar",
        pair: pairOf(from.k, connectorKey(f.elementId, f.connector!)),
        gapIn: f.gapIn,
        facingDot: f.facingDot ?? null,
        crossing: differ(from.cls, classOf(c.classification)),
        opposed: f.opposed,
        autoJoin: false,
      });
      continue;
    }
    if (!("polyline" in target)) continue;
    out.push({
      from: from.k,
      toElement: f.elementId,
      toConnector: null,
      kind: "tap",
      pair: [from.k, String(f.elementId)],
      gapIn: f.gapIn,
      facingDot: f.facingDot ?? null,
      crossing: differ(from.cls, segmentClass(target)),
      opposed: f.opposed,
      autoJoin: false,
      atFt: f.atFt ?? undefined,
      point: f.point ?? undefined,
    });
  }
  return out.sort(
    (x, y) =>
      Math.abs(x.gapIn) - Math.abs(y.gapIn) || x.pair.join("|").localeCompare(y.pair.join("|")),
  );
}

/** A person's ruling on a connector pair (end-to-end, collar) or a connector-and-duct pair (tap). */
export interface ConnectorPairRuling {
  pair: readonly [string, string];
  verdict: "accept" | "reject";
}

/**
 * Rulings over candidates: a rejected pair is dropped; an accepted pair is `ruled` and moves to
 * the front (an accept also joins across classifications); an unruled crossing candidate is
 * dropped, since ends of different classifications never join silently.
 */
export function applyConnectorPairRulings(
  cands: readonly JoinCandidate[],
  rulings: readonly ConnectorPairRuling[],
): JoinCandidate[] {
  const verdict = new Map(rulings.map((r) => [pairOf(r.pair[0], r.pair[1]).join("|"), r.verdict]));
  const kept = cands.flatMap((c) => {
    const v = verdict.get(pairOf(c.pair[0], c.pair[1]).join("|"));
    if (v === "reject") return [];
    if (v === "accept") return [{ ...c, ruled: true }];
    return c.crossing ? [] : [c];
  });
  return [...kept.filter((c) => c.ruled), ...kept.filter((c) => !c.ruled)];
}
