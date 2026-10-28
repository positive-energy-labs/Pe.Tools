/**
 * The fan sheet (MAP step 3): walk each side from the fan port, carry real flow shares, price
 * every leg through the kernel, rank paths worst first, and claim required ESP only when both
 * sides are complete. An implausible or unpriced leg is a blocker and stays out of totals.
 */
import type { FanPort } from "../roster.ts";
import type { Grids } from "../loss-grid.ts";
import type { DuctSnapshot } from "../types.ts";
import { fittingFacts, teePorts, isTap, splitTappedDuct, tapDistance, type LegFlows, type Node, type Segment } from "../kernel/fitting-facts.ts";
import type { ConnectorPairRuling } from "../kernel/inferred-joins.ts";
import { equivalentFeet, priceLeg, type Choices, type PricedLeg } from "../kernel/price-leg.ts";
import { flowsOf, legKey, stateFlow, type FlowOptions, type Flows } from "./flow.ts";
import {
  SHEET_ENGINE_VERSION,
  type Blocker,
  type Chain,
  type FanPortRef,
  type Leg,
  type Sheet,
  type SheetInput,
  type SheetPath,
  type Side,
  type SideTotals,
} from "./types.ts";
import { terminateMerges, graphOf, isSegment, legsOf, lineage, walkFrom, type End, type Graph, type Walk } from "./walk.ts";

export type SheetSnapshot = Pick<DuctSnapshot, "nodes" | "segments" | "document"> & Partial<Pick<DuctSnapshot, "slots">>;

// SHIM(ducts-terminal-drop): 0.03 in-wg is a placeholder pending the firm's per-family table.
export const SHIM_TERMINAL_DROP_IN_WG = 0.03;

export interface PricingInput {
  snapshot: SheetSnapshot;
  grids: Grids;
  choices?: Choices;
  /** Typed drops, in-wg, by element id; they replace any rule or parameter. */
  drops?: Readonly<Record<number, number>>;
  /** Firm defaults; a terminal with no typed or catalog drop takes `terminalDropInWg`. */
  defaults?: { terminalDropInWg?: number; terminalDropSource?: string; splitPolicy?: "even" | "proportional"; slot?: string; autoJoinMaxGapIn?: number; version?: string };
  roster?: readonly FanPort[];
  rulings?: readonly ConnectorPairRuling[];
  candidateBoxIn?: number;
}

export interface BuildSheetInput extends PricingInput {
  fan: FanPortRef;
  roster: readonly FanPort[];
  /** The confirmed airflow slot; the snapshot's terminal-flow slot when absent. */
  slot?: string;
  /** Typed flow at an end, cfm, by element id: a terminal's, or what this fan delivers into another fan's port. */
  endCfm?: Readonly<Record<number, number>>;
  /** A side-stream unit's own flow, cfm, carried at the one roster fan port it feeds. */
  sideStreamCfm?: number;
  splitPolicy?: "even" | "proportional";
  allowanceInWg?: { supply?: number; return?: number };
}

export interface BuildChainInput extends PricingInput {
  start: { elementId: number; connector?: number };
  end: { elementId: number };
  direction: Side;
  /** The flow the chain carries, cfm; the chain has no terminals of its own to sum. */
  flowCfm?: number;
}

const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};
const basisOf = (snapshot: SheetSnapshot, rest: object) =>
  `${SHEET_ENGINE_VERSION}:${fnv(JSON.stringify([snapshot.document.title, snapshot.document.readAt, SHEET_ENGINE_VERSION, rest]))}`;
const round = (n: number) => +n.toFixed(6);
const factOf = (n: Node, key: string) => n.facts.find((f) => f.key === key)?.value ?? null;

/** Shared state of one build: every leg priced once, every blocker keyed once. */
class Pricer {
  legs: Record<string, Leg> = {};
  priced = new Map<string, { blockerIds: string[]; p: PricedLeg | null }>();
  blockers = new Map<string, Blocker>();
  autoJoinNotes = new Set<string>();
  constructor(readonly input: PricingInput, readonly g: Graph) {}

  block = (b: Omit<Blocker, "id">) => {
    const id = `${b.kind}:${b.elementId}${b.connector == null ? "" : `:${b.connector}`}`;
    if (!this.blockers.has(id)) this.blockers.set(id, { id, ...b });
    return id;
  };

  /** A kernel result as a leg's loss, or the blocker that withholds it. */
  private take(p: PricedLeg, el: number): { lossInWg: number | null; ids: string[] } {
    if (p.implausible) {
      const pv = p.source?.kind === "rule" ? p.source.pv : 0;
      return { lossInWg: null, ids: [this.block({
        kind: "implausible-loss", elementId: p.elementId, effectInWg: round(p.implausible.coefficient * pv), detail: p.unpriced!,
        closer: { kind: "ruling", note: "type the fitting's drop or assign another table" },
      })] };
    }
    if (p.unpriced) return { lossInWg: null, ids: [this.block({
      kind: p.kind === "drop" ? "unknown-drop" : "not-priced", elementId: el, effectInWg: null, detail: p.unpriced,
      closer: { kind: p.kind === "drop" ? "default" : "ruling", note: p.kind === "drop" ? "type a drop or take the firm default" : "assign a rule or type the drop" },
    })] };
    return { lossInWg: p.lossInWg, ids: [] };
  }

  /** Price the leg of state `s` leaving by `out`. */
  leg(w: Walk, flows: Flows, side: Side, s: number, out: number | undefined): string[] {
    const st = w.states[s]!;
    const e = st.el;
    const id = `${e.id}:${st.in ?? ""}>${out ?? ""}`;
    const done = this.priced.get(id);
    if (done) return done.blockerIds;
    const f = flows.leg.get(legKey(s, out));
    const cfm = f ? f.cfm : 0;
    const kind: Leg["kind"] = isSegment(e) ? "duct" : e.kind === "cap" ? "fitting" : e.kind;
    const leg: Leg = {
      id, elementId: e.id, kind,
      ...(st.in == null ? {} : { inConnector: st.in }), ...(out == null ? {} : { outConnector: out }),
      flowCfm: cfm, flowSource: f && f.ends ? `${[...f.sources].join("+")}:${f.ends}` : null,
      velocityFpm: null, lossInWg: null, lossSource: { kind: "default", ref: "unpriced" }, equivalentFt: null,
    };
    this.legs[id] = leg;
    const ids = [...(f?.missing ?? [])];
    let p: PricedLeg | null = null;
    if (cfm === 0) {
      leg.lossInWg = 0;
      leg.lossSource = { kind: "default", ref: "carries none of this fan's flow" };
    } else if (cfm != null) {
      const r = this.price(w, flows, side, s, out, cfm);
      p = r.p;
      ids.push(...r.ids);
      if (r.p) {
        const t = r.ids.length ? { lossInWg: null } : { lossInWg: r.p.lossInWg };
        leg.lossInWg = t.lossInWg;
        leg.velocityFpm = r.p.velocityFpm;
        const src = r.p.source;
        leg.lossSource = !src ? leg.lossSource
          : src.kind === "friction" ? { kind: "friction", ref: `Altshul-Tsal, roughness ${src.roughnessFt} ft${r.note ?? ""}` }
          : src.kind === "rule" ? { kind: "rule", ref: `${src.rule} ${src.table} ${src.inputs.res}=${round(src.coefficient)}${r.note ?? ""}` }
          : { kind: src.source.startsWith("firm default") ? "default" : "drop", ref: src.source };
      }
    }
    for (const join of w.autoJoins) {
      if ((join.from[0] === e.id && join.from[1] === out) || (join.to[0] === e.id && join.to[1] === st.in)) {
        leg.lossSource.ref += `; ${join.note}`;
        this.autoJoinNotes.add(join.note);
      }
    }
    this.priced.set(id, { blockerIds: ids, p });
    return ids;
  }

  private price(w: Walk, flows: Flows, side: Side, s: number, out: number | undefined, cfm: number):
    { p: PricedLeg | null; ids: string[]; note?: string } {
    const { grids, choices = {}, drops = {}, defaults = {} } = this.input;
    const st = w.states[s]!;
    const e = st.el;
    const typed = drops[e.id];
    const drop = (inWg: number | null, source: string) => {
      const p = priceLeg({ kind: "drop", element: e as Node, cfm, inWg, source }, grids);
      return { p, ids: this.take(p, e.id).ids };
    };
    if (typed != null) return drop(typed, "typed");
    if (isSegment(e)) return this.duct(w, flows, s, out, cfm);
    const conn = (i: number | undefined) => e.connectors.find((c) => c.index === i);
    if (e.kind === "terminal") {
      const catalog = e.terminalDrop?.catalogDropInWg;
      if (catalog != null) return drop(catalog, `parameter:${this.input.snapshot.slots?.terminalDrop ?? "terminalDrop"}`);
      if (defaults.terminalDropInWg != null) return drop(defaults.terminalDropInWg, defaults.terminalDropSource ?? `firm default ${defaults.version ?? "unversioned"}`);
      return drop(SHIM_TERMINAL_DROP_IN_WG, "SHIM placeholder");
    }
    if (e.kind === "equipment") return drop(null, "inline equipment; no typed drop and no firm default yet");
    const stated = e.kind === "accessory" ? factOf(e, "pressureDrop") : null;
    if (stated != null && stated > 0) return drop(stated, "parameter:pressureDrop");
    if (isTap(e)) return this.tap(w, flows, s, cfm);
    const [inlet, outlet] = side === "supply" ? [conn(st.in), conn(out)] : [conn(out), conn(st.in)];
    const through = stateFlow(flows, s);
    const tee = side === "supply" ? teePorts(e, inlet) : null;
    const branchCfm = tee ? flows.leg.get(legKey(s, tee.branch.index))?.cfm : null;
    const straightCfm = tee ? flows.leg.get(legKey(s, tee.straight.index))?.cfm : null;
    const legFlows: LegFlows = tee && through != null && branchCfm != null && straightCfm != null
      ? { through: cfm, branch: branchCfm, upstreamMain: through, downstreamMain: straightCfm }
      : e.connectors.length > 2 && through != null
      ? { through: cfm, branch: cfm, upstreamMain: through, downstreamMain: through - cfm }
      : { through: cfm };
    // ponytail: return-side junctions are priced on the same (diverging) rules; converging tables are the upgrade.
    const facts = fittingFacts({ fitting: e, inlet, outlet });
    if (e.partType === "Tee" && !tee) delete facts.junction;
    const p = priceLeg({ kind: "fitting", fitting: e, facts, flows: legFlows, leg: "C" }, grids, choices);
    return { p, ids: this.take(p, e.id).ids };
  }

  /** Taps on duct state `s` with their branch flow; null when a branch's flow is unknown. */
  private tapsOn(w: Walk, flows: Flows, s: number) {
    const duct = w.states[s]!.el as Segment;
    const taps = [];
    for (const c of duct.connectors) {
      if (c.kind !== "curve" || c.index === w.states[s]!.in) continue;
      const tap = c.connectedTo && this.node(c.connectedTo.elementId);
      if (!tap || !isTap(tap)) continue;
      const f = flows.leg.get(legKey(s, c.index));
      if (f && f.cfm == null) return null;
      taps.push({ tap, branchCfm: f?.cfm ?? 0 });
    }
    return taps;
  }

  private node(id: number): Node | undefined {
    const e = this.g.byId.get(id);
    return e && !isSegment(e) ? e : undefined;
  }

  private duct(w: Walk, flows: Flows, s: number, out: number | undefined, cfm: number) {
    const { grids, choices = {} } = this.input;
    const st = w.states[s]!;
    const duct = st.el as Segment;
    const inC = duct.connectors.find((c) => c.index === st.in)!;
    const outC = duct.connectors.find((c) => c.index === out);
    const ids: string[] = [];
    let pieces: { kind: "friction"; lengthFt: number; cfm: number }[] = [];
    let cs: PricedLeg[] = [];
    if (inC.kind !== "curve") {
      const taps = this.tapsOn(w, flows, s);
      const upstreamCfm = stateFlow(flows, s);
      if (!taps || upstreamCfm == null) return { p: null, ids };
      const leaveBy = outC?.kind === "curve" ? outC.connectedTo?.elementId ?? null : null;
      const split = splitTappedDuct({ duct, upstream: inC, upstreamCfm, taps, leaveBy });
      pieces = split.filter((x) => x.kind === "friction");
      cs = split.flatMap((x) => x.kind !== "tap-straight" ? [] : [priceLeg({
        kind: "fitting", fitting: x.tap, leg: "Cs", flows: x.flows,
        facts: fittingFacts({ fitting: x.tap, inlet: x.tap.connectors.find((c) => c.connectedTo?.elementId === duct.id), outlet: undefined, main: duct }),
      }, grids, choices)]);
    } else {
      // Entered by a tap on its side: friction from the tap to the connector it leaves by.
      // ponytail: taps passed on the way are not charged here; the split above covers the usual entry.
      const first = duct.connectors.filter((c) => c.kind !== "curve")
        .sort((a, b) => dist(a.point, duct.polyline[0]!) - dist(b.point, duct.polyline[0]!))[0];
      const pos = (c: typeof inC | undefined) => !c ? duct.lengthFt
        : c.kind === "curve" ? tapDistance(duct, { id: c.connectedTo?.elementId ?? -1, point: c.point } as Node, first)
        : dist(c.point, duct.polyline[0]!) <= dist(c.point, duct.polyline.at(-1)!) ? 0 : duct.lengthFt;
      pieces = [{ kind: "friction", lengthFt: Math.abs(pos(outC) - pos(inC)), cfm }];
    }
    const priced = pieces.map((x) => priceLeg({ kind: "duct", segment: duct, lengthFt: x.lengthFt, cfm: x.cfm }, grids));
    let loss = 0;
    for (const p of [...priced, ...cs]) {
      const t = this.take(p, p.elementId);
      ids.push(...t.ids);
      loss += t.lossInWg ?? 0;
    }
    const length = pieces.reduce((a, x) => a + x.lengthFt, 0);
    const fr = priced.reduce((a, p) => a + (p.lossInWg ?? 0), 0);
    const rate = length > 1e-9 && fr > 0 ? (fr / length) * 100 : null;
    const head = priced[0];
    const p: PricedLeg = {
      kind: "duct", elementId: duct.id, lossInWg: loss, velocityFpm: head?.velocityFpm ?? null,
      source: { kind: "friction", f: head?.source?.kind === "friction" ? head.source.f : 0, roughnessFt: duct.roughness.valueFt, rateInWgPer100Ft: rate },
      unpriced: null,
      // Equivalent feet: the straight length, plus any Cs charged on it at this duct's own rate.
      lengthFt: rate ? (loss / rate) * 100 : length,
    };
    return { p, ids, note: `, ${round(length)} ft${cs.length ? `, ${cs.length} tap(s) passed (Cs)` : ""}` };
  }

  private tap(w: Walk, flows: Flows, s: number, cfm: number): { p: PricedLeg | null; ids: string[]; note?: string } {
    const { grids, choices = {} } = this.input;
    const st = w.states[s]!;
    const tap = st.el as Node;
    const parent = w.states[st.parent]!;
    const main = isSegment(parent.el) ? parent.el : null;
    const fromSide = main && main.connectors.find((c) => c.index === st.via)?.kind === "curve";
    if (!main || !fromSide) {
      // ponytail: a merge's receiving-stream flow is not this fan's to invent; only price its branch when observed.
      const mainPort = tap.connectors.find((c) => c.index !== st.in);
      const receiving = mainPort?.connectedTo && this.g.byId.get(mainPort.connectedTo.elementId);
      const mainCfm = receiving && isSegment(receiving) ? receiving.connectors.reduce((max, c) => Math.max(max, c.flowCfm ?? 0), 0) : 0;
      if (!receiving || !isSegment(receiving) || mainCfm <= 0)
        return { p: { kind: "drop", elementId: tap.id, lossInWg: null, velocityFpm: null,
          source: { kind: "drop", source: "merge boundary; branch loss unavailable without receiving-stream flow" }, unpriced: null }, ids: [] };
      const p = priceLeg({ kind: "fitting", fitting: tap, leg: "Cb",
        flows: { through: cfm, branch: cfm, upstreamMain: mainCfm + cfm, downstreamMain: mainCfm },
        facts: fittingFacts({ fitting: tap, inlet: tap.connectors.find((c) => c.index === st.in), outlet: undefined, main: receiving }),
      }, grids, choices);
      // ponytail: this uses the existing diverging-table estimate; a retained converging grid must replace it for merge certification.
      return { p, ids: this.take(p, tap.id).ids, note: ", diverging-table estimate at merge" };
    }
    const parentIn = main.connectors.find((c) => c.index === parent.in)!;
    const taps = parentIn.kind === "curve" ? null : this.tapsOn(w, flows, st.parent);
    const up = stateFlow(flows, st.parent);
    const branch = taps && up != null
      ? splitTappedDuct({ duct: main, upstream: parentIn, upstreamCfm: up, taps, leaveBy: tap.id }).at(-1)
      : undefined;
    const legFlows: LegFlows = branch?.kind === "tap-branch" ? branch.flows
      : { through: cfm, branch: cfm, upstreamMain: up ?? cfm, downstreamMain: (up ?? cfm) - cfm };
    const p = priceLeg({
      kind: "fitting", fitting: tap, leg: "Cb", flows: legFlows,
      facts: fittingFacts({ fitting: tap, inlet: tap.connectors.find((c) => c.index === st.in), outlet: undefined, main }),
    }, grids, choices);
    return { p, ids: this.take(p, tap.id).ids };
  }

  /** One path per end, legs priced, equivalent feet at each leg's own rate. */
  paths(w: Walk, flows: Flows, side: Side, ends: readonly End[] = w.ends): SheetPath[] {
    return ends.map((e) => {
      const legIds = legsOf(w, e);
      const chain = lineage(w, e.state);
      const blockerIds = new Set<string>(e.blockerIds);
      chain.forEach((s, k) => {
        w.states[s]!.blockerIds.forEach((b) => blockerIds.add(b));
        const out = k + 1 < chain.length ? w.states[chain[k + 1]!]!.via : e.out;
        this.leg(w, flows, side, s, out).forEach((b) => blockerIds.add(b));
      });
      const priced = legIds.map((id) => this.priced.get(id)?.p ?? null);
      const eq = equivalentFeet(priced.map((p, i) => p ?? { kind: "drop", elementId: this.legs[legIds[i]!]!.elementId, lossInWg: null, velocityFpm: null, source: null, unpriced: "" }));
      legIds.forEach((id, i) => {
        const leg = this.legs[id]!;
        if (leg.equivalentFt == null && leg.lossInWg != null && eq[i] != null) leg.equivalentFt = round(eq[i]!);
      });
      const knownInWg = round(legIds.reduce((a, id) => a + (this.legs[id]!.lossInWg ?? 0), 0));
      return { side, legIds, end: e.end, knownInWg, complete: blockerIds.size === 0, blockerIds: [...blockerIds] };
    });
  }
}

const terminalDropInputs = (pricer: Pricer): SheetInput[] =>
  Object.values(pricer.legs).some((l) => l.lossSource.ref.includes("SHIM"))
    ? [{ name: "SHIM terminal drop in-wg", value: SHIM_TERMINAL_DROP_IN_WG, source: "SHIM placeholder" }] : [];

const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));

function totals(pricer: Pricer, paths: SheetPath[], allowanceInWg: number): SideTotals {
  const complete = paths.length > 0 && paths.every((p) => p.complete);
  const worst = paths[0];
  const legs = worst ? worst.legIds.map((id) => pricer.legs[id]!) : [];
  const telFt = round(legs.reduce((a, l) => a + (l.equivalentFt ?? 0), 0));
  const worstPath = complete && worst ? worst.knownInWg : null;
  // Rate the duct and fittings actually run at: the worst path less its typed drops, over TEL.
  const drops = legs.filter((l) => l.lossSource.kind === "drop" || l.lossSource.kind === "default").reduce((a, l) => a + (l.lossInWg ?? 0), 0);
  return {
    worstPath, knownInWg: worst?.knownInWg ?? 0, allowanceInWg, complete, telFt,
    frictionRatePer100: worstPath != null && telFt > 0 ? round(((worstPath - drops) * 100) / telFt) : null,
  };
}

const rank = (paths: SheetPath[]) => paths.sort((a, b) => b.knownInWg - a.knownInWg || a.legIds.length - b.legIds.length);

const carrying = (e: End) => e.end.kind === "terminal" || e.end.kind === "roster-fan-port" || e.end.kind === "joins-other-fan";

/** The ends choose direction; connector metadata breaks ties only. */
function endDirection(w: Walk, g: Graph, roster: readonly FanPort[]): { score: number; source: string } {
  let score = 0;
  const reasons = new Set<string>();
  for (const e of w.ends) {
    const el = g.byId.get(e.end.elementId);
    if (!el) continue;
    if (e.directionHint) {
      score += e.directionHint === "supply" ? 1 : -1;
      reasons.add(e.directionHint === "supply" ? "merge toward receiving fan inlet/return" : "merge toward another fan discharge");
      continue;
    }
    const port = el.connectors.find((c) => c.index === e.end.connector);
    const cls = (port?.classification ?? (isSegment(el) ? el.classification : null) ?? "").replaceAll(" ", "").toLowerCase();
    if (!isSegment(el) && e.end.kind === "terminal") {
      if (/louver|outside|outdoor|intake/i.test(`${el.family ?? ""} ${el.type ?? ""}`) || /outdoor|exhaust|return/.test(cls)) {
        score--; reasons.add("return/exhaust terminal or outdoor intake");
      } else if (/supply/.test(cls)) { score++; reasons.add("supply terminal"); }
    } else if (e.end.kind === "roster-fan-port" && e.end.elementId !== w.states[0]!.el.id) {
      const receiver = roster.find((p) => p.unitId === e.end.elementId && p.inletPortIndex === e.end.connector);
      if (receiver || /return/.test(cls) || port?.direction === "in") { score++; reasons.add("receiving fan inlet/return"); }
      else if (port?.direction === "out") { score--; reasons.add("another fan discharge"); }
    } else if (/outdoor/.test(cls)) { score--; reasons.add("outdoor-air end"); }
  }
  // A merge into another fan's return is discharge evidence even when no terminal lies on this fan's side.

  return { score, source: [...reasons].join("; ") || "no classified end" };
}

/** A side's delivered flow: the sum of its carrying ends; null if any lacks one. */
const sideSum = (f: Flows, w: Walk) => {
  const ends = w.ends.map((e, i) => [e, f.end[i]] as const).filter(([e]) => carrying(e));
  return ends.some(([, v]) => v == null) ? null : ends.reduce((a, [, v]) => a + v!, 0);
};

export function buildSheet(input: BuildSheetInput): Sheet {
  const g = graphOf(input.snapshot);
  const pricer = new Pricer(input, g);
  const unit = g.byId.get(input.fan.unitId);
  if (!unit || isSegment(unit)) throw new Error(`fan unit ${input.fan.unitId} is not in the snapshot`);
  const entry = input.roster.find((p) => p.unitId === unit.id && p.portIndex === input.fan.portIndex);
  const pairedInlet = entry?.inletPortIndex !== input.fan.portIndex ? entry?.inletPortIndex
    : unit.connectors.length === 2 ? unit.connectors.find((c) => c.index !== input.fan.portIndex)?.index : undefined;
  const opts = { roster: input.roster, rulings: input.rulings ?? [], candidateBoxIn: input.candidateBoxIn, autoJoinMaxGapIn: input.defaults?.autoJoinMaxGapIn };
  const a = walkFrom(g, unit, input.fan.portIndex, opts);
  const b = pairedInlet == null ? null : walkFrom(g, unit, pairedInlet, opts);
  terminateMerges(a);
  if (b) terminateMerges(b);
  const aRule = endDirection(a, g, input.roster), bRule = b ? endDirection(b, g, input.roster) : null;
  const swap = !!bRule && bRule.score > aRule.score;
  const discharge = swap ? pairedInlet! : input.fan.portIndex;
  const inlet = swap ? input.fan.portIndex : pairedInlet ?? null;
  const directionSource = bRule && aRule.score !== bRule.score
    ? `ends: discharge ${swap ? bRule.source : aRule.source}; paired side is inlet`
    : "port metadata tie-break: ends do not distinguish the paired sides";
  const slot = input.slot ?? input.defaults?.slot ?? input.snapshot.slots?.terminalFlow ?? "terminalFlow";
  // The side-stream exception uses the unit design parameter; terminal-led fan flow remains a sum.
  const design = factOf(unit, "fanFlow");
  const designCfm = design != null && design > 0 ? design : null;
  const flowOpts: FlowOptions = {
    slot, endCfm: input.endCfm ?? {},
    sideStream: input.sideStreamCfm != null ? { cfm: input.sideStreamCfm, source: "typed" }
      : designCfm == null ? null : { cfm: designCfm, source: `parameter:${input.snapshot.slots?.fanFlow ?? "fanFlow"}` },
    splitPolicy: input.splitPolicy ?? input.defaults?.splitPolicy ?? "even",
    receivingDesignCfm: Object.fromEntries(input.snapshot.nodes.map((n) => [n.id, factOf(n, "fanFlow")])),
  };
  const supply = { w: swap ? b! : a };
  const ret = b ? { w: swap ? a : b } : null;
  for (const w of [supply.w, ret?.w]) if (w) {
    for (const [id, blocker] of w.blockers) pricer.blockers.set(id, blocker);
  }
  // A side whose one end carries nothing (an intake, an open end) carries the other side's flow.
  const single = (w: Walk) => w.ends.length === 1 && !carrying(w.ends[0]!);
  const balanced = (w: Walk, other: number | null): FlowOptions =>
    single(w) && other ? { ...flowOpts, only: { end: 0, cfm: other, source: `balance; splitPolicy:${flowOpts.splitPolicy}` } } : flowOpts;
  const retFirst = !!ret && single(supply.w);
  const retFlows = ret && retFirst ? flowsOf(ret.w, flowOpts, pricer.block) : null;
  const supplyFlows = flowsOf(supply.w, balanced(supply.w, retFlows ? sideSum(retFlows, ret!.w) : null), pricer.block);
  const returnFlows = ret ? retFlows ?? flowsOf(ret.w, balanced(ret.w, sideSum(supplyFlows, supply.w)), pricer.block) : null;
  const supplyPaths = rank(pricer.paths(supply.w, supplyFlows, "supply"));
  const returnPaths = ret ? rank(pricer.paths(ret.w, returnFlows!, "return")) : [];
  if (!ret) pricer.block({
    kind: "open-end", elementId: unit.id, effectInWg: null, detail: `the roster names no inlet for ${unit.id}; the return side is not walked`,
    closer: { kind: "ruling", note: "check the fan's paired duct ports; no inlet could be identified" },
  });
  const allowance = { supply: input.allowanceInWg?.supply ?? 0, return: input.allowanceInWg?.return ?? 0 };
  const sT = totals(pricer, supplyPaths, allowance.supply);
  const rT = ret ? totals(pricer, returnPaths, allowance.return)
    : { worstPath: null, knownInWg: 0, allowanceInWg: allowance.return, complete: false, telFt: 0, frictionRatePer100: null };
  const required = sT.worstPath != null && rT.worstPath != null && sT.complete && rT.complete
    ? round(sT.worstPath + rT.worstPath + sT.allowanceInWg + rT.allowanceInWg) : null;
  const flowCfm = retFirst ? sideSum(returnFlows!, ret!.w) : sideSum(supplyFlows, supply.w);
  const walked = new Set<number>();
  for (const w of [supply.w, ret?.w]) if (w) for (const id of w.depth.keys()) walked.add(id);

  const inputs: SheetInput[] = [
    { name: "auto-join maximum gap in", value: input.defaults?.autoJoinMaxGapIn ?? 3, source: input.defaults?.autoJoinMaxGapIn == null ? "default" : "route settings" },
    ...(input.defaults?.terminalDropInWg == null || input.defaults.terminalDropSource === "SHIM placeholder" ? []
      : [{ name: "terminal drop in-wg", value: input.defaults.terminalDropInWg, source: input.defaults.terminalDropSource ?? `firm default ${input.defaults.version ?? "unversioned"}` }]),
    { name: "split policy", value: flowOpts.splitPolicy ?? "even", source: input.splitPolicy ? "typed" : input.defaults?.splitPolicy ? "route settings" : "default" },
    { name: "unit design cfm", value: flowOpts.sideStream?.cfm ?? null, source: flowOpts.sideStream?.source ?? "missing design-flow parameter" },
    { name: "airflow slot", value: slot, source: input.slot ? "typed" : input.defaults?.slot ? "route settings" : "snapshot slots" },
    { name: "supply allowance in-wg", value: allowance.supply, source: input.allowanceInWg?.supply == null ? "default 0" : "typed" },
    { name: "return allowance in-wg", value: allowance.return, source: input.allowanceInWg?.return == null ? "default 0" : "typed" },
    { name: "inlet connector", value: inlet, source: directionSource },
    { name: "discharge connector", value: discharge, source: directionSource },
    { name: "candidate box in", value: input.candidateBoxIn ?? 36, source: input.candidateBoxIn == null ? "default" : "typed" },
    ...(input.sideStreamCfm == null ? [] : [{ name: "side-stream cfm", value: input.sideStreamCfm, source: "typed" }]),
    ...terminalDropInputs(pricer),
    ...[...pricer.autoJoinNotes].map((note) => ({ name: note, value: null, source: "default auto-join" })),
    ...Object.values(pricer.legs).filter((l) => l.lossSource.ref.includes("diverging-table estimate at merge"))
      .map((l) => ({ name: `merge ${l.elementId} branch loss model`, value: "diverging-table estimate", source: l.lossSource.ref })),
    ...Object.values(pricer.legs).filter((l) => l.lossSource.ref.startsWith("merge boundary"))
      .map((l) => ({ name: `merge ${l.elementId} branch loss in-wg`, value: null, source: l.lossSource.ref })),
    ...Object.entries(input.endCfm ?? {}).map(([id, v]) => ({ name: `end ${id} cfm`, value: v, source: "typed" })),
    ...Object.entries(input.drops ?? {}).map(([id, v]) => ({ name: `element ${id} drop in-wg`, value: v, source: "typed" })),
    ...Object.entries(input.choices ?? {}).map(([k, v]) => ({ name: `table for ${k}`, value: v, source: "typed" })),
  ];
  const ratedEsp = factOf(unit, "externalStatic");
  const cited = new Set([...supplyPaths, ...returnPaths].flatMap((p) => p.blockerIds));
  return {
    engineVersion: SHEET_ENGINE_VERSION,
    basis: basisOf(input.snapshot, [input.fan, inlet, input.rulings, input.endCfm, input.drops, input.defaults, input.sideStreamCfm, input.allowanceInWg, input.choices, slot, input.splitPolicy, input.candidateBoxIn]),
    fan: {
      unitId: unit.id, portIndex: input.fan.portIndex,
      mark: entry?.tag || unit.facts.find((f) => f.key === "mark")?.text || "",
      ratedEspInWg: ratedEsp, inletPortIndex: inlet, dischargePortIndex: discharge, flowCfm,
    },
    legs: pricer.legs,
    paths: [...supplyPaths, ...returnPaths],
    totals: { supply: sT, return: rT, requiredEspInWg: required },
    // Only what a path or the fan carries; a branch cut to another fan keeps its blockers off this sheet.
    blockers: [...pricer.blockers.values()].filter((b) => cited.has(b.id) || b.elementId === unit.id),
    inputs,
    walkedElementIds: [...walked].sort((a, b) => a - b),
  };
}

/** One chain between an asserted start and end; priced at the typed flow; no ESP claim. */
export function buildChain(input: BuildChainInput): Chain {
  const g = graphOf(input.snapshot);
  const pricer = new Pricer(input, g);
  const start = g.byId.get(input.start.elementId);
  if (!start) throw new Error(`start ${input.start.elementId} is not in the snapshot`);
  // ponytail: the start element is the root and is not priced; start at the unit or terminal itself.
  const w = walkFrom(g, start, input.start.connector, { roster: input.roster ?? [], rulings: input.rulings ?? [], candidateBoxIn: input.candidateBoxIn, autoJoinMaxGapIn: input.defaults?.autoJoinMaxGapIn });
  for (const [id, b] of w.blockers) pricer.blockers.set(id, b);
  terminateMerges(w);
  let at = w.ends.findIndex((e) => e.end.elementId === input.end.elementId);
  if (at < 0) {
    const s = w.states.findIndex((st, i) => i > 0 && st.el.id === input.end.elementId);
    if (s > 0 && !lineage(w, s).some((k) => w.states[k]!.merge)) {
      const el = w.states[s]!.el;
      w.ends.push({ state: s, out: undefined, blockerIds: [], end: { kind: !isSegment(el) && el.kind === "terminal" ? "terminal" : "open-end", elementId: el.id } });
      at = w.ends.length - 1;
    }
  }
  const inputs: SheetInput[] = [
    { name: "chain cfm", value: input.flowCfm ?? null, source: input.flowCfm == null ? "none" : "typed" },
    ...Object.entries(input.drops ?? {}).map(([id, v]) => ({ name: `element ${id} drop in-wg`, value: v, source: "typed" })),
  ];
  let path: SheetPath | null = null;
  if (at < 0) pricer.block({
    kind: "open-end", elementId: input.end.elementId, effectInWg: null,
    detail: `${input.end.elementId} is not reached from ${input.start.elementId} under the walk's stop rules`,
    closer: { kind: "ruling", note: "check the start connector, or rule the stops between" },
  });
  else {
    const flows = flowsOf(w, { slot: "", only: { end: at, cfm: input.flowCfm ?? null, source: "typed" } }, pricer.block);
    path = pricer.paths(w, flows, input.direction, [w.ends[at]!])[0]!;
  }
  const legs: Record<string, Leg> = {};
  for (const id of path?.legIds ?? []) legs[id] = pricer.legs[id]!;
  return {
    engineVersion: SHEET_ENGINE_VERSION,
    basis: basisOf(input.snapshot, [input.start, input.end, input.direction, input.flowCfm, input.rulings, input.drops, input.choices, input.defaults]),
    start: input.start, direction: input.direction, path, legs,
    blockers: [...pricer.blockers.values()].filter((b) => !path || path.blockerIds.includes(b.id)),
    inputs: [...inputs, ...terminalDropInputs(pricer), ...[...pricer.autoJoinNotes].map((note) => ({ name: note, value: null, source: "default auto-join" }))],
    walkedElementIds: [...w.depth.keys()].sort((a, b) => a - b),
  };
}
