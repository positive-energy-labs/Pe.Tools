import {
  classOf,
  connectorKey,
  segmentClass,
  type ConnectorPairRuling,
  type Element,
  type Near,
} from "../kernel/inferred-joins.ts";
import type { HealProposal } from "./types.ts";

type Port = Element["connectors"][number];
export const rulingFor = (
  pair: readonly [string, string],
  rulings: readonly ConnectorPairRuling[],
) => rulings.findLast((r) => r.pair.every((p) => pair.includes(p)))?.verdict;

/**
 * Heals for one open end, ranked: join first, body tap second, occupied junction last; never an
 * unaccepted air-type crossing. The neighbourhood is C#'s measurement (`near`, model health); the
 * proposal, its risk and its ranking are the sheet's.
 */
export function proposeHeals(
  from: Element,
  port: Port,
  near: Near | undefined,
  g: ReadonlyMap<number, Element>,
  rulings: readonly ConnectorPairRuling[],
  unavailable: ReadonlySet<string> = new Set(),
): HealProposal[] {
  const cls =
    classOf(port.classification) ??
    ("classification" in from ? classOf(from.classification) : null);
  const sameAir = (other: string | null) => !cls || !other || cls === other;
  const proposals: HealProposal[] = [];
  const add = (
    kind: HealProposal["kind"],
    target: Element,
    connector: number | null,
    point: number[],
    gapIn: number,
    fittingChange: boolean,
  ) => {
    const pair: [string, string] = [
      connectorKey(from.id, port.index),
      connector == null ? String(target.id) : connectorKey(target.id, connector),
    ];
    if (rulingFor(pair, rulings) === "reject") return;
    proposals.push({
      kind,
      from: { elementId: from.id, connector: port.index, point: port.point },
      to: { elementId: target.id, connector, point },
      pair,
      gapIn,
      fittingChange,
      risk:
        kind === "tee"
          ? "Riskiest: replace occupied connection with a tee; fitting loss required"
          : kind === "tap"
            ? "Add a branch fitting at the duct body; fitting loss required"
            : fittingChange
              ? "Extend and turn or resize; fitting loss required"
              : "Extend at the source section; extension friction included",
      assumedLegs: [],
    });
  };
  for (const p of near?.ports ?? []) {
    const target = g.get(p.elementId);
    if (!target || target.id === from.id || (!("polyline" in target) && target.kind === "cap"))
      continue;
    if (unavailable.has(connectorKey(p.elementId, p.connector))) continue;
    const c = target.connectors.find((x) => x.index === p.connector);
    if (!c) continue;
    const other =
      classOf(c.classification) ??
      ("classification" in target ? classOf(target.classification) : null);
    // Ends of different air classes never join silently; an accept ruling on the pair joins them
    // (as `applyConnectorPairRulings` does), e.g. a SupplyAir grille 0.01 in from a ReturnAir plenum.
    if (
      !sameAir(other) &&
      rulingFor([connectorKey(from.id, port.index), connectorKey(target.id, c.index)], rulings) !==
        "accept"
    )
      continue;
    if (c.connectedTo) {
      // An occupied mouth is offered only with an explicit fitting change, never as a join.
      if ("polyline" in target || target.connectors.length >= 3)
        add("tee", target, c.index, c.point, p.gapIn, true);
    } else {
      const sameSize =
        port.shape === c.shape &&
        port.diameterIn === c.diameterIn &&
        port.widthIn === c.widthIn &&
        port.heightIn === c.heightIn;
      add("join", target, c.index, c.point, p.gapIn, !p.aligned || !sameSize);
    }
  }
  for (const b of near?.bodies ?? []) {
    const segment = g.get(b.segmentId);
    if (!segment || !("polyline" in segment) || b.tapGapIn == null || !b.tapPoint) continue;
    if (!sameAir(segmentClass(segment))) continue;
    add("tap", segment, null, b.tapPoint, b.tapGapIn, true);
  }
  const priority = { join: 0, tap: 1, tee: 2 };
  return proposals.sort((a, b) => {
    const accepted = (p: HealProposal) => (rulingFor(p.pair, rulings) === "accept" ? 0 : 1);
    return (
      accepted(a) - accepted(b) ||
      priority[a.kind] - priority[b.kind] ||
      a.gapIn - b.gapIn ||
      a.pair.join("|").localeCompare(b.pair.join("|"))
    );
  });
}
