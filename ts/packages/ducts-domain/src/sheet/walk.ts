/**
 * The per-side walk (MAP step 3, W0-A's binding rules): BFS over connectors from one fan
 * connector. Stops at any roster unit (nothing credited from it), a terminal, an open end, or
 * equipment that is not a 2-port inline part. Inferred joins only to vacant opposed ports.
 * Revit direction never chooses an edge; classification only raises `class-change`.
 */
import type { FanPort } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import {
  applyConnectorPairRulings,
  candidates,
  classOf,
  openPort,
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
}

/** A path end: legs are the ancestors of `state` (root excluded), the last leaving by `out`. */
export interface End {
  state: number;
  out: number | undefined;
  end: PathEnd;
  blockerIds: string[];
}

export interface Walk {
  states: State[];
  ends: End[];
  blockers: Map<string, Blocker>;
  /** Element id -> hop depth, stop elements included (a fan or equipment the walk ended at). */
  depth: Map<number, number>;
  /** Arrivals at an element already entered (a loop or a second route); not walked again. */
  rejoins: number;
}

export interface WalkOptions {
  roster: readonly FanPort[];
  rulings?: readonly ConnectorPairRuling[];
  candidateBoxIn?: number;
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

/** Walk from `connector` of `unit` outward. */
export function walkFrom(g: Graph, unit: Element, connector: number | undefined, opts: WalkOptions): Walk {
  const rosterUnits = new Set(opts.roster.map((p) => p.unitId));
  const box = (opts.candidateBoxIn ?? DEFAULT_CANDIDATE_BOX_IN) / 24;
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
    if (p.cls && cls && cls !== p.cls)
      blockerIds.push(block({
        kind: "class-change", elementId: e.id, connector: ci, effectInWg: null,
        detail: `air changes from ${p.cls} to ${cls} entering ${e.id}:${ci}`,
        closer: { kind: "ruling", note: "confirm the asserted flow continues across the classification change" },
      }));
    states.push({ el: e, in: ci, parent, via, depth: d, cls, blockerIds });
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
    const cands = applyConnectorPairRulings(candidates(open, nearby), opts.rulings ?? []);
    const follow = cands.find((k) =>
      k.kind !== "tap" && k.toConnector != null && (k.ruled || (k.facingDot ?? 0) <= -OPPOSED_COS));
    if (follow) {
      const carry = follow.ruled ? [] : [block({
        kind: "inferred-join", elementId: st.el.id, connector: c.index, effectInWg: null,
        detail: `open ${open.k} joined to vacant ${follow.toElement}:${follow.toConnector} across ${follow.gapIn.toFixed(3)} in (${follow.kind}, ${follow.grade})`,
        closer: { kind: "ruling", note: "accept or reject the connector pair", candidate: { toElementId: follow.toElement, toConnector: follow.toConnector, gapIn: follow.gapIn, pair: follow.pair } },
      })];
      return enter(g.byId.get(follow.toElement)!, follow.toConnector!, s, c.index, carry);
    }
    const best = cands[0];
    if (best) {
      // The target is occupied (a capped end) or a duct side: never healed silently (W0-A rule 2).
      const seg = g.byId.get(best.toElement);
      const at = best.point ?? c.point;
      const port = seg?.connectors.reduce((a, b) =>
        Math.hypot(...b.point.map((v, k) => v - at[k]!)) < Math.hypot(...a.point.map((v, k) => v - at[k]!)) ? b : a);
      const cap = port?.connectedTo ? g.byId.get(port.connectedTo.elementId) : undefined;
      const capped = cap && !isSegment(cap) && cap.kind === "cap" ? cap : undefined;
      const gapNative = port ? Math.hypot(...port.point.map((v, k) => v - c.point[k]!)) * 12 : null;
      const id = block({
        kind: "inferred-join", elementId: st.el.id, connector: c.index, effectInWg: null,
        detail: capped
          ? `open ${open.k} faces ${best.toElement}:${port!.index}, already capped by ${capped.id}: face gap ${best.gapIn.toFixed(3)} in, connector gap ${gapNative!.toFixed(3)} in`
          : `open ${open.k} lands on ${best.kind} ${best.toElement}${best.toConnector == null ? "" : `:${best.toConnector}`} across ${best.gapIn.toFixed(3)} in; not a vacant opposed port`,
        closer: {
          kind: "heal",
          note: capped ? `remove cap ${capped.id} and connect, or rule the pair` : "heal the join in Revit, or rule the pair",
          candidate: { toElementId: best.toElement, toConnector: best.toConnector ?? port?.index ?? null, gapIn: best.gapIn, pair: best.pair },
        },
      });
      return end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
    }
    const id = block({
      kind: "open-end", elementId: st.el.id, connector: c.index, effectInWg: null,
      detail: `${st.el.id}:${c.index} is open with nothing within ${(box * 24).toFixed(0)} in`,
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
  return { states, ends, blockers, depth, rejoins };
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
 * Cut the branches another fan owns (MAP pillar 7, joins-other-fan): past the first
 * classification change on a path the walk has entered another fan's network, and the asserted
 * flow runs only toward the nearest roster fan port beyond it. Every other end past that change
 * belongs to that fan; F's path to it is cut where it leaves F's path to the port.
 * ponytail: needs a classification change to see the boundary; a tap into a same-class network
 * is not cut (upgrade: a connector-pair ruling naming the join).
 */
export function cutAtClassChange(f: Walk): void {
  const crossing = (s: number) =>
    lineage(f, s).find((k) => f.states[k]!.blockerIds.some((b) => b.startsWith("class-change:")));
  const owners = new Map<number, End>();
  for (const e of f.ends) {
    const c = e.end.kind === "roster-fan-port" ? crossing(e.state) : undefined;
    const held = c == null ? undefined : owners.get(c);
    if (c != null && (!held || lineage(f, e.state).length < lineage(f, held.state).length)) owners.set(c, e);
  }
  const kept: End[] = [];
  const cuts = new Set<string>();
  for (const e of f.ends) {
    const c = crossing(e.state);
    const owner = c == null ? undefined : owners.get(c);
    if (!owner || owner === e) { kept.push(e); continue; }
    const mine = new Set(lineage(f, owner.state));
    const at = lineage(f, e.state).findLast((s) => mine.has(s))!;
    const key = `${at}:${owner.end.elementId}`;
    if (cuts.has(key)) continue;
    cuts.add(key);
    const st = f.states[at]!;
    kept.push({
      state: st.parent, out: st.via, blockerIds: [],
      end: { kind: "joins-other-fan", elementId: st.el.id, ...(st.in == null ? {} : { connector: st.in }), fan: owner.end.fan! },
    });
  }
  f.ends = kept;
}
