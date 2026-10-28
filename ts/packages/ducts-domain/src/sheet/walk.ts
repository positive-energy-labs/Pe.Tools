/**
 * The per-side walk (MAP step 3, W0-A's binding rules): BFS over connectors from one fan
 * connector. Stops at any roster unit (nothing credited from it), a terminal, an open end, or
 * equipment that is not a 2-port inline part. Inferred joins only to vacant opposed ports.
 * Revit direction never chooses an edge; class changes and branch entries mark stream merges.
 */
import { isTap } from "../kernel/fitting-facts.ts";
import type { FanPort } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import {
  applyConnectorPairRulings,
  candidates,
  classOf,
  openPort,
  sidesOf,
  type ConnectorPairRuling,
  type Element,
} from "../kernel/inferred-joins.ts";
import type { Blocker, FanPortRef, PathEnd } from "./types.ts";

type Connector = Element["connectors"][number];

/** Two outward axes this close to antiparallel are opposed (inferred-joins NEAR_MISS_OPPOSED_COS). */
const OPPOSED_COS = 0.9;
export const DEFAULT_CANDIDATE_BOX_IN = 36;

export interface Graph {
  all: readonly Element[];
  byId: ReadonlyMap<number, Element>;
}
export const graphOf = (s: Pick<DuctSnapshot, "nodes" | "segments">): Graph => {
  const all = [...s.nodes, ...s.segments];
  return { all, byId: new Map(all.map((e) => [e.id, e])) };
};
export const isSegment = (e: Element): e is DuctSnapshot["segments"][number] => "polyline" in e;

/** One element entered once. The root (the fan) is state 0 and never a leg. */
export interface State {
  el: Element;
  in: number | undefined;
  parent: number;
  /** The parent's connector this state was reached by. */
  via: number | undefined;
  depth: number;
  cls: string | null;
  blockerIds: string[];
  merge?: "class-change" | "branch-tap";
}

/** A path end: legs are the ancestors of `state` (root excluded), the last leaving by `out`. */
export interface End {
  state: number;
  out: number | undefined;
  end: PathEnd;
  blockerIds: string[];
  directionHint?: "supply" | "return";
}

export interface Walk {
  states: State[];
  ends: End[];
  blockers: Map<string, Blocker>;
  /** Element id -> hop depth, stop elements included (a fan or equipment the walk ended at). */
  depth: Map<number, number>;
  /** Arrivals at an element already entered (a loop or a second route); not walked again. */
  rejoins: number;
  autoJoins: { from: readonly [number, number]; to: readonly [number, number]; gapIn: number; note: string }[];
}

export interface WalkOptions {
  roster: readonly FanPort[];
  rulings?: readonly ConnectorPairRuling[];
  candidateBoxIn?: number;
  autoJoinMaxGapIn?: number;
}

export const legId = (elementId: number, inC: number | undefined, out: number | undefined) =>
  `${elementId}:${inC ?? ""}>${out ?? ""}`;

/** The roster entry a walk reached at `connector` of unit `unitId`: the port, else its inlet, else the first. */
export function rosterRef(roster: readonly FanPort[], unitId: number, connector: number | undefined): FanPortRef | null {
  const own = roster.filter((p) => p.unitId === unitId);
  const hit = own.find((p) => p.portIndex === connector) ?? own.find((p) => p.inletPortIndex === connector) ?? own[0];
  return hit ? { unitId: hit.unitId, portIndex: hit.portIndex } : null;
}

const near = (e: Element, p: number[], r: number) => {
  const d = (q: number[]) => Math.max(...q.map((v, k) => Math.abs(v - p[k]!)));
  if (e.connectors.some((c) => c.point.length === 3 && d(c.point) <= r)) return true;
  if (!isSegment(e)) return false;
  // A long duct body can pass the box with no vertex in it: test the closest point of each piece.
  const pad = Math.max(e.diameterIn ?? 0, e.widthIn ?? 0, e.heightIn ?? 0) / 24;
  return e.polyline.slice(1).some((b, i) => {
    const a = e.polyline[i]!;
    const ab = b.map((v, k) => v - a[k]!);
    const len2 = ab.reduce((s, v) => s + v * v, 0);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ab.reduce((s, v, k) => s + v * (p[k]! - a[k]!), 0) / len2));
    return d(a.map((v, k) => v + ab[k]! * t)) <= r + pad;
  });
};

/** Nearest physical candidate, including occupied/sideways ports that inference intentionally rejects. */
function nearestCandidate(nearby: readonly Element[], point: number[], withinIn: number) {
  const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
  const choices = nearby.flatMap((e) => e.connectors.map((c) => ({
    label: `${e.id}:${c.index}`, gapIn: distance(point, c.point) * 12, state: c.connectedTo ? "occupied" : "vacant",
  })));
  for (const side of sidesOf(nearby.filter(isSegment))) {
    const v = point.map((x, i) => x - side.a[i]!);
    const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);
    const t = dot(v, side.u);
    const axial = Math.max(-t, t - side.len, 0);
    const radial = v.map((x, i) => x - t * side.u[i]!);
    const section = side.section;
    const across = "w" in section
      ? Math.hypot(Math.max(0, Math.abs(dot(radial, section.x)) - section.w), Math.max(0, Math.abs(dot(radial, section.y)) - section.h))
      : Math.max(0, Math.hypot(...radial) - section.outer);
    choices.push({ label: `${side.owner} duct body`, gapIn: Math.hypot(axial, across) * 12, state: "occupied surface (no vacant port)" });
  }
  return choices.filter((c) => c.gapIn <= withinIn).sort((a, b) => a.gapIn - b.gapIn)[0];
}

/** Walk from `connector` of `unit` outward. */
export function walkFrom(g: Graph, unit: Element, connector: number | undefined, opts: WalkOptions): Walk {
  const rosterUnits = new Set(opts.roster.map((p) => p.unitId));
  const searchIn = opts.candidateBoxIn ?? DEFAULT_CANDIDATE_BOX_IN;
  const box = searchIn / 12;
  const autoGapIn = opts.autoJoinMaxGapIn ?? 3;
  const autoJoins: Walk["autoJoins"] = [];
  const joinedPorts = new Set<string>();
  const states: State[] = [{ el: unit, in: undefined, parent: -1, via: undefined, depth: 0, cls: null, blockerIds: [] }];
  const ends: End[] = [];
  const blockers = new Map<string, Blocker>();
  const depth = new Map<number, number>([[unit.id, 0]]);
  const entered = new Set<number>([unit.id]);
  let rejoins = 0;

  const block = (b: Omit<Blocker, "id">) => {
    const id = `${b.kind}:${b.elementId}${b.connector == null ? "" : `:${b.connector}`}`;
    if (!blockers.has(id)) blockers.set(id, { id, ...b });
    return id;
  };
  const end = (state: number, out: number | undefined, e: PathEnd, blockerIds: string[] = []) =>
    ends.push({ state, out, end: e, blockerIds });

  const queue: number[] = [];
  const exits = (s: State, c: Connector) => s.el.connectors.filter((o) => o.index !== c.index);

  const enter = (e: Element, ci: number, parent: number, via: number, carry: string[]) => {
    const p = states[parent]!;
    const d = p.depth + 1;
    if (!depth.has(e.id)) depth.set(e.id, d);
    if (rosterUnits.has(e.id) || e.id === unit.id) {
      const fan = rosterRef(opts.roster, e.id, ci) ?? { unitId: e.id, portIndex: ci };
      return end(parent, via, { kind: "roster-fan-port", elementId: e.id, connector: ci, fan }, carry);
    }
    if (entered.has(e.id)) return void rejoins++;
    entered.add(e.id);
    const c = e.connectors.find((x) => x.index === ci);
    if (!isSegment(e) && e.kind === "cap") return; // sealed: no air leaves by a cap
    if (!isSegment(e) && e.kind === "equipment" && e.connectors.length !== 2) {
      const id = block({
        kind: "equipment-pairing", elementId: e.id, connector: ci, effectInWg: null,
        detail: `${e.family ?? "equipment"} ${e.id} has ${e.connectors.length} duct connectors and is not a roster fan; which one air leaves by is not known`,
        closer: { kind: "ruling", note: `rule a connector pair through ${e.id}, or confirm it as a roster fan` },
      });
      return end(parent, via, { kind: "open-end", elementId: e.id, connector: ci }, [...carry, id]);
    }
    const blockerIds = [...carry];
    const cls = classOf(c?.classification) ?? p.cls;
    const branchTap = !isSegment(e) && isTap(e)
      && (!isSegment(p.el) || p.el.connectors.find((port) => port.index === via)?.kind !== "curve");
    const terminal = !isSegment(e) && e.kind === "terminal";
    const merge = branchTap ? "branch-tap" as const : !terminal && p.cls && cls && cls !== p.cls ? "class-change" as const : undefined;
    states.push({ el: e, in: ci, parent, via, depth: d, cls, blockerIds, ...(merge ? { merge } : {}) });
    const s = states.length - 1;
    if (!isSegment(e) && e.kind === "terminal") return end(s, undefined, { kind: "terminal", elementId: e.id, connector: ci });
    queue.push(s);
  };

  const leave = (s: number, c: Connector) => {
    const st = states[s]!;
    const to = c.connectedTo;
    if (to) {
      const target = g.byId.get(to.elementId);
      if (target) return enter(target, to.connector, s, c.index, []);
      const id = block({
        kind: "open-end", elementId: st.el.id, connector: c.index, effectInWg: null,
        detail: `${st.el.id}:${c.index} connects to ${to.elementId}:${to.connector}, which the snapshot does not hold`,
        closer: { kind: "default", note: "re-read with the element in scope" },
      });
      return end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
    }
    const open = openPort(st.el, c);
    const nearby = g.all.filter((e) => e.id !== st.el.id && near(e, c.point, box));
    const rawCandidates = candidates(open, nearby, searchIn).filter((candidate) =>
      candidate.toConnector == null || !joinedPorts.has(`${candidate.toElement}:${candidate.toConnector}`));
    const rejected = (pair: readonly string[]) => opts.rulings?.some((r) => r.verdict === "reject" && r.pair.every((p) => pair.includes(p)));
    const auto = rawCandidates.find((k) => k.toConnector != null && k.kind !== "tap"
      && !rejected(k.pair) && (k.facingDot ?? 0) <= -OPPOSED_COS
      && Math.hypot(...g.byId.get(k.toElement)!.connectors.find((p) => p.index === k.toConnector)!.point.map((v, i) => v - c.point[i]!)) * 12 <= autoGapIn);
    const cands = applyConnectorPairRulings(rawCandidates, opts.rulings ?? []);
    const follow = cands.find((k) =>
      k.kind !== "tap" && k.toConnector != null && k.ruled) ?? auto;
    if (follow) {
      const targetPort = g.byId.get(follow.toElement)!.connectors.find((p) => p.index === follow.toConnector)!;
      const gapIn = Math.hypot(...targetPort.point.map((v, i) => v - c.point[i]!)) * 12;
      if (auto === follow) {
        const note = `auto-joined ${open.k} to ${follow.toElement}:${follow.toConnector} across ${gapIn.toFixed(3)} in, default \u2264${autoGapIn} in`;
        autoJoins.push({ from: [st.el.id, c.index], to: [follow.toElement, follow.toConnector!], gapIn, note });
        joinedPorts.add(open.k); joinedPorts.add(`${follow.toElement}:${follow.toConnector}`);
      }
      return enter(g.byId.get(follow.toElement)!, follow.toConnector!, s, c.index, []);
    }
    const best = cands[0] ?? rawCandidates.find((k) => !rejected(k.pair));
    if (best) {
      // The target is occupied (a capped end) or a duct side: never healed silently (W0-A rule 2).
      const seg = g.byId.get(best.toElement);
      const at = best.point ?? c.point;
      const port = best.toConnector != null ? seg?.connectors.find((p) => p.index === best.toConnector) : seg?.connectors.reduce((a, b) =>
        Math.hypot(...b.point.map((v, k) => v - at[k]!)) < Math.hypot(...a.point.map((v, k) => v - at[k]!)) ? b : a);
      const cap = port?.connectedTo ? g.byId.get(port.connectedTo.elementId) : undefined;
      const capped = cap && !isSegment(cap) && cap.kind === "cap" ? cap : undefined;
      const gapNative = port ? Math.hypot(...port.point.map((v, k) => v - c.point[k]!)) * 12 : null;
      const id = block({
        kind: "inferred-join", elementId: st.el.id, connector: c.index, effectInWg: null,
        detail: capped
          ? `open ${open.k} faces ${best.toElement}:${port!.index}, already capped by ${capped.id}: face gap ${best.gapIn.toFixed(3)} in, connector gap ${gapNative!.toFixed(3)} in`
                    : best.toConnector == null
            ? `open ${open.k} lands on ${best.toElement} duct body at face gap ${best.gapIn.toFixed(3)} in, occupied surface (no vacant port)`
            : `open ${open.k} nearest candidate ${best.toElement}:${best.toConnector} at ${gapNative!.toFixed(3)} in, ${port?.connectedTo ? "occupied" : "vacant"}, ${(best.facingDot ?? 0) <= -OPPOSED_COS ? "opposed" : "sideways or facing unknown"}; default auto-join requires vacant opposed ports within ${autoGapIn} in`,
        closer: {
          kind: "heal",
          note: capped ? `remove cap ${capped.id} and connect, or rule the pair` : "heal the join in Revit, or rule the pair",
          candidate: { toElementId: best.toElement, toConnector: best.toConnector ?? port?.index ?? null, gapIn: best.gapIn, pair: best.pair },
        },
      });
      return end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
    }
    const nearest = nearestCandidate(nearby, c.point, searchIn);
    const id = block({
      kind: "open-end", elementId: st.el.id, connector: c.index, effectInWg: null,
      detail: nearest
        ? `${st.el.id}:${c.index} is open; nearest candidate ${nearest.label} at ${nearest.gapIn.toFixed(3)} in, ${nearest.state}`
        : `${st.el.id}:${c.index} is open with nothing within ${searchIn} in`,
      closer: { kind: "ruling", note: "mark it an intended open end with a drop, or draw the continuation" },
    });
    end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
  };

  const start = connector == null ? unit.connectors : unit.connectors.filter((c) => c.index === connector);
  states[0]!.cls = classOf(start[0]?.classification);
  for (const c of start) leave(0, c);
  while (queue.length) {
    const s = queue.shift()!;
    const st = states[s]!;
    const inC = st.el.connectors.find((c) => c.index === st.in)!;
    for (const c of exits(st, inC)) leave(s, c);
  }
  return { states, ends, blockers, depth, rejoins, autoJoins };
}

/** Ancestor states of `s`, root first, root excluded. */
export function lineage(w: Walk, s: number): number[] {
  const out: number[] = [];
  for (let k = s; k > 0; k = w.states[k]!.parent) out.push(k);
  return out.reverse();
}

/** Leg ids along an end's path, in walk order. */
export function legsOf(w: Walk, e: End): string[] {
  const chain = lineage(w, e.state);
  return chain.map((s, i) => {
    const st = w.states[s]!;
    const out = i + 1 < chain.length ? w.states[chain[i + 1]!]!.via : e.out;
    return legId(st.el.id, st.in, out);
  });
}

/**
 * A fan's air ends where it merges into another stream. Look beyond the merge only to name
 * its receiving roster fan; downstream legs and blockers do not belong to this sheet.
 */
export function terminateMerges(w: Walk): void {
  const first = (e: End) => lineage(w, e.state).find((s) => w.states[s]!.merge);
  const owners = new Map<number, End>();
  for (const e of w.ends) {
    const at = first(e);
    if (at == null || e.end.kind !== "roster-fan-port" || e.end.elementId === w.states[0]!.el.id) continue;
    const prior = owners.get(at);
    if (!prior || lineage(w, e.state).length < lineage(w, prior.state).length) owners.set(at, e);
  }
  const seen = new Set<number>();
  w.ends = w.ends.flatMap((e): End[] => {
    const at = first(e);
    if (at == null) return [e];
    if (seen.has(at)) return [];
    seen.add(at);
    const st = w.states[at]!;
    const branch = st.merge === "branch-tap";
    // Branch tap itself is the last owned leg. At a class change, stop before the other stream.
    const out = branch ? st.el.connectors.find((c) => c.index !== st.in)?.index : st.via;
    const owner = owners.get(at)?.end;
    const directionHint = owner?.fan
      ? owner.connector === owner.fan.portIndex ? "return" as const : "supply" as const
      : /supply/i.test(w.states[st.parent]!.cls ?? "") && /return/i.test(st.cls ?? "") ? "supply" as const : undefined;
    return [{ state: branch ? at : st.parent, out, blockerIds: [], ...(directionHint ? { directionHint } : {}), end: {
      kind: "joins-other-fan", elementId: st.el.id, ...(st.in == null ? {} : { connector: st.in }),
      fan: owners.get(at)?.end.fan ?? null,
    } }];
  });
}
