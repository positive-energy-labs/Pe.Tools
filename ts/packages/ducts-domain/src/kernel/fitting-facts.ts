/** Lifted from `losses.ts` (fittingFacts, tapDistance, the tapped-duct leg split); network-free: no tree, group, root or fan. */
import { transitionGeometry } from "../geometry.ts";
import { sectionOf } from "../loss-physics.ts";
import type { FittingFacts, Flows, Leg, Port } from "../loss-rules.ts";
import type { DuctSnapshot } from "../types.ts";

export type Node = DuctSnapshot["nodes"][number];
export type Segment = DuctSnapshot["segments"][number];
export type Connector = Node["connectors"][number];

export const factOf = (node: Node, key: string) =>
  node.facts.find((f) => f.key === key)?.value ?? null;

export const portOf = (c: Connector | undefined): Port | null =>
  c
    ? {
        shape: c.shape,
        section: sectionOf(c.shape, c.diameterIn, c.widthIn, c.heightIn),
        widthIn: c.widthIn,
        heightIn: c.heightIn,
      }
    : null;

export const segmentSection = (s: Segment) =>
  sectionOf(s.shape, s.diameterIn, s.widthIn, s.heightIn);

export const isTap = (node: Node | null | undefined) =>
  !!node && (node.partType?.startsWith("Tap") === true || factOf(node, "takeoff") === 1);

/**
 * Flow at a leg, cfm. A plain fitting carries `through`; a junction also carries the branch, the
 * main upstream of the tap and the main downstream of it (loss-rules.ts asks for all three).
 */
export interface LegFlows {
  through: number;
  branch?: number;
  upstreamMain?: number;
  downstreamMain?: number;
}

/** `LegFlows` as `loss-rules.ts` spells them. */
export const ruleFlows = (f: LegFlows): Flows => ({
  q: f.through,
  qb: f.branch,
  qc: f.upstreamMain,
  qs: f.downstreamMain,
});

/** How a path traverses a fitting: the connector it enters by and the one it leaves by. */
export interface FittingTraversal {
  fitting: Node;
  /** The connector facing the fan on this path; undefined when nothing on the path states it. */
  inlet: Connector | undefined;
  /** The connector the path leaves by; undefined for a tap passed straight, or a dead end. */
  outlet: Connector | undefined;
  /** The duct a tap hangs off, for its main section; null when unknown. */
  main?: Segment | null;
}

/** A plain tee entered from its run. Branch-entry/converging geometry has no diverging mapping. */
export function teePorts(node: Node, inlet: Connector | undefined) {
  if (
    node.partType !== "Tee" ||
    node.connectors.length !== 3 ||
    !inlet?.facing ||
    inlet.shape !== "round"
  )
    return null;
  const dot = (a: number[], b: number[]) =>
    a.reduce((sum, v, k) => sum + v * b[k]!, 0) / (Math.hypot(...a) * Math.hypot(...b));
  const straight = node.connectors.find(
    (c) => c.index !== inlet.index && c.facing && dot(inlet.facing!, c.facing) < -0.99,
  );
  const branch = node.connectors.find(
    (c) => c.index !== inlet.index && c.index !== straight?.index,
  );
  return straight?.shape === "round" &&
    branch?.shape === "round" &&
    branch.facing &&
    Math.abs(dot(inlet.facing, branch.facing)) < 0.01
    ? { straight, branch }
    : null;
}

/**
 * Facts the rules read, from a node's connectors and W1 facts. The caller asserts the traversal;
 * a transition with one In and one Out connector still reads its physical pair (as losses.ts did).
 */
export function fittingFacts({
  fitting: node,
  inlet: walkedInlet,
  outlet: walkedOutlet,
  main,
}: FittingTraversal): FittingFacts {
  const tap = isTap(node);
  const transition = node.partType === "Transition";
  const physical = transition ? transitionGeometry(node) : null;
  // Connectors that are not one In and one Out (bidirectional on Project A) take the asserted direction.
  const walked = physical != null && physical.inlet == null;
  const inlet = physical?.inlet ?? walkedInlet ?? node.connectors[0];
  const outlet = physical?.outlet ?? (tap ? undefined : walkedOutlet);
  const tee = teePorts(node, inlet);
  const inletPort = portOf(inlet) ?? { shape: "other", section: null };
  const outletPort = portOf(outlet);
  const ratio =
    inletPort.section && outletPort?.section
      ? outletPort.section.areaFt2 / inletPort.section.areaFt2
      : null;
  // A tap collar connector is the branch size; the main is the duct it hangs off.
  const mainArea = factOf(node, "mainArea");
  const mainPort: Port | null = !tap
    ? null
    : mainArea != null
      ? {
          shape: "round",
          section: { areaFt2: mainArea, dhIn: 12 * Math.sqrt((4 * mainArea) / Math.PI) },
        }
      : main
        ? { shape: main.shape, section: segmentSection(main) }
        : null;
  return {
    kind: node.kind === "accessory" ? "accessory" : "fitting",
    family: node.family ?? null,
    partType: node.partType ?? null,
    rOverD: factOf(node, "rOverD"),
    centerRadiusIn: factOf(node, "centerRadius"),
    ...(tee &&
    outlet &&
    inletPort.section &&
    portOf(tee.branch)?.section &&
    portOf(tee.straight)?.section
      ? {
          junction: {
            branch: portOf(tee.branch)!,
            straight: portOf(tee.straight)!,
            leg: outlet.index === tee.branch.index ? ("Cb" as const) : ("Cs" as const),
          },
        }
      : {}),
    aoOverA1: transition ? ratio : (factOf(node, "aoOverA1") ?? ratio),
    angleDeg: physical ? physical.angleDeg : factOf(node, "angle"),
    ...(walked
      ? { note: "oriented by the asserted walk; its connectors state no In/Out pair" }
      : {}),
    inputError: physical?.error,
    inlet: inletPort,
    outlet: outletPort,
    main: mainPort,
    abOverAc: factOf(node, "abOverAc"),
    takeoff: tap,
  };
}

const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));

/**
 * Distance of a tap from the upstream end of its duct, ft, along the centerline. `upstream` is
 * the duct's end connector facing the fan (asserted by the caller); without one the polyline's
 * first point is taken as upstream.
 */
export function tapDistance(duct: Segment, tap: Node, upstream: Connector | undefined): number {
  const poly = duct.polyline;
  const legs = poly.slice(1).map((p, i) => dist(p, poly[i]!));
  const total = legs.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const curve = duct.connectors.find((c) => c.connectedTo?.elementId === tap.id);
  const at = curve?.point ?? tap.point;
  let best = { d: Infinity, s: 0 };
  let run = 0;
  poly.slice(1).forEach((b, i) => {
    const a = poly[i]!;
    const ab = b.map((v, k) => v - a[k]!);
    const len2 = ab.reduce((s, v) => s + v * v, 0);
    const dot = ab.reduce((s, v, k) => s + v * (at[k]! - a[k]!), 0);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot / len2));
    const d = dist(
      a.map((v, k) => v + ab[k]! * t),
      at,
    );
    if (d < best.d) best = { d, s: run + t * legs[i]! };
    run += legs[i]!;
  });
  const fromEnd =
    upstream != null && dist(upstream.point, poly.at(-1)!) < dist(upstream.point, poly[0]!);
  const s = fromEnd ? total - best.s : best.s;
  return Math.max(0, Math.min(duct.lengthFt, (s / total) * duct.lengthFt));
}

/** A tap on a duct with the flow its branch carries, cfm. */
export interface TapOn {
  tap: Node;
  branchCfm: number;
}

/** One piece of a tapped duct, in flow order. */
export type DuctPiece =
  | { kind: "friction"; lengthFt: number; cfm: number }
  | { kind: "tap-straight"; tap: Node; leg: Leg; flows: LegFlows; atFt: number }
  | { kind: "tap-branch"; tap: Node; leg: Leg; flows: LegFlows; atFt: number };

/**
 * The tap leg split: a tapped duct cut at each tap along its centerline. The part up to a tap
 * carries the upstream flow; a tap the path passes charges Cs on the main downstream; the tap the
 * path leaves by (`leaveBy`) charges Cb on the branch and ends the main there (handcalc.py). A tap
 * with no branch flow is passed without a leg. Returns the pieces in flow order.
 */
export function splitTappedDuct(args: {
  duct: Segment;
  upstream: Connector | undefined;
  upstreamCfm: number;
  taps: readonly TapOn[];
  leaveBy?: number | null;
}): DuctPiece[] {
  const { duct, upstream, upstreamCfm, taps, leaveBy = null } = args;
  const ordered = taps
    .map((t) => ({ ...t, pos: tapDistance(duct, t.tap, upstream) }))
    .sort((a, b) => a.pos - b.pos || a.tap.id - b.tap.id);
  const pieces: DuctPiece[] = [];
  let q = upstreamCfm;
  let at = 0;
  const run = (lengthFt: number, cfm: number) => {
    if (lengthFt > 1e-9) pieces.push({ kind: "friction", lengthFt, cfm });
  };
  for (const t of ordered) {
    run(t.pos - at, q);
    at = t.pos;
    if (t.tap.id === leaveBy) {
      pieces.push({
        kind: "tap-branch",
        tap: t.tap,
        leg: "Cb",
        flows: {
          through: t.branchCfm,
          branch: t.branchCfm,
          upstreamMain: q,
          downstreamMain: q - t.branchCfm,
        },
        atFt: at,
      });
      return pieces;
    }
    if (t.branchCfm > 0) {
      pieces.push({
        kind: "tap-straight",
        tap: t.tap,
        leg: "Cs",
        flows: {
          through: q,
          branch: t.branchCfm,
          upstreamMain: q,
          downstreamMain: q - t.branchCfm,
        },
        atFt: at,
      });
      q -= t.branchCfm;
    }
  }
  run(duct.lengthFt - at, q);
  return pieces;
}
