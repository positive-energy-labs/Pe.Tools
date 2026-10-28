import {
  axisOf,
  classOf,
  sidesOf,
  type Element,
  type ConnectorPairRuling,
} from "../kernel/inferred-joins.ts";
import type { HealProposal } from "./types.ts";

type Port = Element["connectors"][number];
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
export const rulingFor = (
  pair: readonly [string, string],
  rulings: readonly ConnectorPairRuling[],
) => rulings.findLast((r) => r.pair.every((p) => pair.includes(p)))?.verdict;

/** Join first, body tap second, occupied junction last. Never propose an air-type crossing. */
export function proposeHeal(
  from: Element,
  port: Port,
  nearby: readonly Element[],
  rulings: readonly ConnectorPairRuling[],
  withinIn = 36,
  unavailable: ReadonlySet<string> = new Set(),
): HealProposal | undefined {
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
      `${from.id}:${port.index}`,
      connector == null ? String(target.id) : `${target.id}:${connector}`,
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
  for (const target of nearby) {
    if (target.id === from.id || (!("polyline" in target) && target.kind === "cap")) continue;
    for (const c of target.connectors) {
      if (unavailable.has(`${target.id}:${c.index}`)) continue;
      const other =
        classOf(c.classification) ??
        ("classification" in target ? classOf(target.classification) : null);
      if (!sameAir(other)) continue;
      const gapIn = distance(port.point, c.point) * 12;
      if (gapIn > withinIn) continue;
      if (c.connectedTo) {
        // An occupied mouth is offered only with an explicit fitting change, never as a join.
        if ("polyline" in target || target.connectors.length >= 3)
          add("tee", target, c.index, c.point, gapIn, true);
      } else {
        const a = axisOf(from, port),
          b = axisOf(target, c);
        const displacement = c.point.map((v, i) => v - port.point[i]!);
        const axial = a && dot(displacement, a);
        const lateral = a && Math.hypot(...displacement.map((v, i) => v - axial! * a[i]!));
        const aligned = a && b && dot(a, b) <= -0.9 && axial! >= -1e-6 && lateral! * 12 <= 0.5;
        const sameSize =
          port.shape === c.shape &&
          port.diameterIn === c.diameterIn &&
          port.widthIn === c.widthIn &&
          port.heightIn === c.heightIn;
        add("join", target, c.index, c.point, gapIn, !aligned || !sameSize);
      }
    }
  }
  for (const side of sidesOf(
    nearby.filter((e): e is Extract<Element, { polyline: unknown }> => "polyline" in e),
  )) {
    if (!sameAir(side.cls)) continue;
    const offset = port.point.map((v, i) => v - side.a[i]!);
    const t = dot(offset, side.u);
    // A tap must land inside the body, away from an end's mouth.
    const margin =
      Math.max(
        side.segment.diameterIn ?? 0,
        side.segment.widthIn ?? 0,
        side.segment.heightIn ?? 0,
      ) / 24;
    if (t <= margin || t >= side.len - margin) continue;
    const center = side.a.map((v, i) => v + t * side.u[i]!);
    const radial = port.point.map((v, i) => v - center[i]!);
    const s = side.section;
    const surface =
      "w" in s
        ? center.map(
            (v, i) =>
              v +
              Math.max(-s.w, Math.min(s.w, dot(radial, s.x))) * s.x[i]! +
              Math.max(-s.h, Math.min(s.h, dot(radial, s.y))) * s.y[i]!,
          )
        : center.map(
            (v, i) => v + radial[i]! * Math.min(1, s.outer / (Math.hypot(...radial) || 1)),
          );
    const gapIn = distance(port.point, surface) * 12;
    if (gapIn <= Math.min(24, withinIn)) add("tap", side.segment, null, surface, gapIn, true);
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
  })[0];
}
