/**
 * The fan sheet (MAP step 3): walk each side from the fan port, carry real flow shares, price
 * every leg through the kernel, rank paths worst first, and claim required ESP only when both
 * sides are complete. An implausible or unpriced leg is a blocker and stays out of totals.
 */
import type { FanPort } from "../roster.ts";
import type { Grids } from "../loss-grid.ts";
import type { DuctSnapshot } from "../types.ts";
import {
  fittingFacts,
  teePorts,
  isTap,
  splitTappedDuct,
  ruleFlows,
  tapDistance,
  type LegFlows,
  type Node,
  type Segment,
} from "../kernel/fitting-facts.ts";
import {
  equivalentFeet,
  priceLeg,
  type Choices,
  type LegInput,
  type PricedLeg,
} from "../kernel/price-leg.ts";
import {
  LOSS_RULES,
  ruleByKey,
  ruleWords,
  type FittingFacts,
  type LossRule,
} from "../loss-rules.ts";
import {
  flowsOf,
  legKey,
  sharedTerminal,
  stateFlow,
  type FlowOptions,
  type Flows,
} from "./flow.ts";
import {
  SHEET_ENGINE_VERSION,
  type Blocker,
  type Chain,
  type FanPortRef,
  type FittingPricing,
  type Leg,
  type Sheet,
  type SheetNote,
  type SheetPath,
  type Side,
  type SideTotals,
} from "./types.ts";
import {
  terminateMerges,
  foreignOwners,
  graphOf,
  isSegment,
  legId,
  legsOf,
  lineage,
  markSiblings,
  walkFrom,
  type End,
  type Graph,
  type Walk,
} from "./walk.ts";
import { assumedFanFlows, type AssumedFlow } from "./assumed-flow.ts";
import type { DuctsInputs, Resolved } from "@pe/agent-contracts";
import { PROPOSED_KEY, terminalCfmOf } from "./inputs.ts";
import { REVIT_FLOW_SLOT, slotFlowOf } from "../kernel/terminal-flow.ts";

/** Issues and tolerances are C#'s model health (ducts LEDGER 2026-10-29); absent, no open end has a measured neighbourhood. */
export type SheetSnapshot = Pick<DuctSnapshot, "nodes" | "segments" | "document"> &
  Partial<Pick<DuctSnapshot, "slots" | "issues" | "tolerances">>;

export interface PricingInput {
  snapshot: SheetSnapshot;
  grids: Grids;
  /** Everything the engine prices from, resolved by the host (`resolveInputs`); the engine defaults nothing. */
  inputs: DuctsInputs;
  roster: readonly FanPort[];
}

export interface BuildSheetInput extends PricingInput {
  fan: FanPortRef;
  /** Proof switch: compare topology assumptions with/without derived fan flow. Known is unaffected. */
  assumeServedFlow?: boolean;
}

export interface BuildChainInput extends PricingInput {
  start: { elementId: number; connector?: number };
  end: { elementId: number };
  direction: Side;
  /** The chain's asserted flow, cfm; request-scoped, not a design value. */
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

/** A resolved value's provenance as a leg's `lossSource.ref` reads it. */
const provenance = (v: Resolved<unknown>) => `${v.source}${v.ref ? `:${v.ref}` : ""}`;
const positive = (v: number | null | undefined) => (v != null && v > 0 ? v : null);

/**
 * The rules a person may price a fitting with: those of its own sort (a round elbow's elbow rules, a
 * takeoff's takeoff and junction rules), else those naming its family.
 */
function candidatesFor(f: FittingFacts): FittingPricing["candidates"] {
  const fits = (r: LossRule) =>
    f.takeoff
      ? /^(tap|bullhead|junction)-/.test(r.key)
      : f.partType === "Tee"
        ? /^(tee|junction)-/.test(r.key)
        : f.partType === "Elbow"
          ? r.key.startsWith("elbow-") &&
            (f.inlet.shape === "round") === r.family.startsWith("Round")
          : f.partType === "Transition"
            ? r.key.startsWith("trx-")
            : r.family === f.family;
  return LOSS_RULES.filter(fits).map((r) => ({
    rule: r.key,
    words: ruleWords(r),
    tables: [...new Set([r.table, ...r.options])],
  }));
}

/** A priced leg's source as a leg row reads it. */
function lossSourceOf(src: NonNullable<PricedLeg["source"]>, note = ""): Leg["lossSource"] {
  return src.kind === "friction"
    ? { kind: "friction", ref: `Altshul-Tsal, roughness ${src.roughnessFt} ft${note}` }
    : src.kind === "rule"
      ? {
          kind: "rule",
          ref: `${src.rule} ${src.table} ${src.inputs.res}=${round(src.coefficient)}${note}`,
        }
      : { kind: src.source.startsWith("firm default") ? "default" : "drop", ref: src.source };
}

type ProposedPath = NonNullable<FittingPricing["proposed"]>;

/** Shared state of one build: every leg priced once, every blocker keyed once. */
class Pricer {
  legs: Record<string, Leg> = {};
  priced = new Map<string, { blockerIds: string[]; p: PricedLeg | null }>();
  blockers = new Map<string, Blocker>();
  autoJoinNotes = new Set<string>();
  healNotes = new Set<string>();
  /** Every fitting priced, by census key (element id, or a proposed fitting's path key). */
  fittings = new Map<string, FittingPricing>();
  /**
   * The census keys each leg priced: a fitting leg its own, a duct leg the taps it passes (Cs), a
   * proposed fitting's path leg its path key. The census keeps only fittings a path of this sheet
   * crosses (`fittingsOn`): a heal or a branch the walk priced past another fan's cut is not this
   * fan's (MUAS-1 listed FC-23's assumed tee 13771256|13771267, 2026-10-29).
   */
  private censusOf = new Map<string, Set<string>>();
  private pricingLeg: string | undefined;
  private onLeg(legId: string, key: string) {
    this.censusOf.set(legId, (this.censusOf.get(legId) ?? new Set()).add(key));
  }
  /** The census rows the given paths cross, in census order. */
  fittingsOn(paths: readonly SheetPath[]): FittingPricing[] {
    const keys = new Set(
      paths.flatMap((p) => p.legIds.flatMap((id) => [...(this.censusOf.get(id) ?? [])])),
    );
    return [...this.fittings.values()].filter((f) => keys.has(f.key));
  }
  /** A heal's proposed-fitting leg per main element its branch path continues into. */
  private healPaths = new Map<string, Map<number, string>>();
  /** R-B: the cause of the leg being priced, stamped on every blocker it raises. */
  private cause: string | undefined;
  /** Loss-rule key to table, where a person swapped one (`inputs.tables`). */
  readonly choices: Choices;
  constructor(
    readonly input: PricingInput,
    readonly g: Graph,
  ) {
    this.choices = Object.fromEntries(
      Object.entries(input.inputs.tables).map(([key, table]) => [key, table.value]),
    );
  }

  block = (b: Omit<Blocker, "id">) => {
    const id = `${b.kind}:${b.elementId}${b.connector == null ? "" : `:${b.connector}`}`;
    const causedBy = b.causedBy ?? this.cause;
    if (!this.blockers.has(id))
      this.blockers.set(id, { id, ...b, ...(causedBy ? { causedBy } : {}) });
    return id;
  };

  /** A kernel result as a leg's loss, or the blocker that withholds it. */
  private take(
    p: PricedLeg,
    el: number,
    census = p.kind === "fitting" && this.fittings.has(String(el)) ? String(el) : undefined,
  ): { lossInWg: number | null; ids: string[] } {
    if (p.implausible) {
      const pv = p.source?.kind === "rule" ? p.source.pv : 0;
      return {
        lossInWg: null,
        ids: [
          this.block({
            kind: "implausible-loss",
            // The element the leg is charged to: a proposed transition's stand-in node has no id.
            elementId: el,
            effectInWg: round(p.implausible.coefficient * pv),
            detail: p.unpriced!,
            closer: { kind: "ruling", note: "type the fitting's drop or assign another table" },
            ...(census ? { fitting: census } : {}),
          }),
        ],
      };
    }
    if (p.unpriced)
      return {
        lossInWg: null,
        ids: [
          this.block({
            kind: p.kind === "drop" ? "unknown-drop" : "not-priced",
            elementId: el,
            effectInWg: null,
            detail: p.unpriced,
            closer: {
              kind: p.kind === "drop" ? "default" : "ruling",
              note:
                p.kind === "drop"
                  ? "type a drop or take the firm default"
                  : "price it with a table (a rule for its family) or type the drop",
            },
            ...(census ? { fitting: census } : {}),
          }),
        ],
      };
    return { lossInWg: p.lossInWg, ids: [] };
  }

  /**
   * Price the leg of state `s` leaving by `out`. `share`: one path through a takeoff entered from
   * its branch whose air divides both ways along the main (`splitShare`), keyed by the main element
   * the path continues into and carrying that path's own flow.
   */
  leg(
    w: Walk,
    flows: Flows,
    side: Side,
    s: number,
    out: number | undefined,
    share?: { toward: number; cfm: number | null },
  ): { id: string; blockerIds: string[] } {
    const st = w.states[s]!;
    const e = st.el;
    const id = `${e.id}:${st.in ?? ""}>${out ?? ""}${share ? `>${share.toward}` : ""}`;
    const done = this.priced.get(id);
    if (done) return { id, blockerIds: done.blockerIds };
    this.cause = st.causedBy;
    const outer = this.pricingLeg;
    this.pricingLeg = id;
    try {
      return { id, blockerIds: this.legOnce(w, flows, side, s, out, id, share) };
    } finally {
      this.cause = undefined;
      this.pricingLeg = outer;
    }
  }

  /**
   * The landing a takeoff entered from its branch hands its air to (R-Q4 split: the landing is a
   * walked child), and the flow on each way out of it along the main.
   */
  private landingOf(w: Walk, flows: Flows, s: number) {
    const st = w.states[s]!;
    const tap = st.el;
    if (s === 0 || isSegment(tap) || !isTap(tap)) return null;
    const parent = w.states[st.parent]!;
    const fromSide =
      isSegment(parent.el) &&
      parent.el.connectors.find((c) => c.index === st.via)?.kind === "curve";
    if (fromSide) return null;
    const mainPort = tap.connectors.find((c) => c.index !== st.in);
    const landing = w.states.findIndex(
      (x, i) => i > 0 && x.parent === s && x.via === mainPort?.index,
    );
    if (landing < 0) return null;
    const ways = w.states[landing]!.el.connectors.filter(
      (c) => c.index !== w.states[landing]!.in,
    ).map((c) => ({ out: c.index, cfm: flows.leg.get(legKey(landing, c.index))?.cfm ?? 0 }));
    return { landing, ways };
  }

  /**
   * On the supply, the path's own share through a takeoff entered from its branch whose collar air
   * divides both ways along the main: the main element it continues into and the flow it carries
   * there. Null for every other leg (one shared leg prices them).
   */
  private splitShare(w: Walk, flows: Flows, side: Side, chain: number[], k: number, e: End) {
    if (side !== "supply") return null;
    const at = this.landingOf(w, flows, chain[k]!);
    if (!at || at.ways.filter((x) => x.cfm == null || x.cfm > 0).length < 2) return null;
    if (chain[k + 1] !== at.landing) return null;
    const el = w.states[at.landing]!.el;
    const out = k + 2 < chain.length ? w.states[chain[k + 2]!]!.via : e.out;
    const way = at.ways.find((x) => x.out === out);
    if (!way) return null;
    return {
      toward: el.connectors.find((c) => c.index === out)?.connectedTo?.elementId ?? el.id,
      cfm: way.cfm,
    };
  }

  private legOnce(
    w: Walk,
    flows: Flows,
    side: Side,
    s: number,
    out: number | undefined,
    id: string,
    share?: { toward: number; cfm: number | null },
  ): string[] {
    const st = w.states[s]!;
    const e = st.el;
    const f = flows.leg.get(legKey(s, out));
    const cfm = share ? share.cfm : f ? f.cfm : 0;
    const kind: Leg["kind"] = isSegment(e) ? "duct" : e.kind === "cap" ? "fitting" : e.kind;
    const leg: Leg = {
      id,
      elementId: e.id,
      kind,
      ...(st.in == null ? {} : { inConnector: st.in }),
      ...(out == null ? {} : { outConnector: out }),
      flowCfm: cfm,
      flowSource: f && f.ends ? `${[...f.sources].join("+")}:${f.ends}` : null,
      velocityFpm: null,
      lossInWg: null,
      lossSource: { kind: "default", ref: "unpriced" },
      equivalentFt: null,
    };
    this.legs[id] = leg;
    const ids = [...(f?.missing ?? [])];
    let p: PricedLeg | null = null;
    if (cfm == null) this.unknownFlowRow(w, side, s, out);
    if (cfm === 0) {
      leg.lossInWg = 0;
      leg.lossSource = { kind: "default", ref: "carries none of this fan's flow" };
    } else if (cfm != null) {
      const r = this.price(w, flows, side, s, out, cfm);
      p = r.p;
      ids.push(...r.ids);
      if (r.cfm != null && r.cfm !== cfm) {
        leg.flowCfm = r.cfm;
        leg.flowSource = `${leg.flowSource ?? "flow"}; ${round(r.cfm)} cfm where it enters, ${round(cfm)} cfm leaves by connector ${out ?? "none"}`;
      }
      if (r.p) {
        const t = r.ids.length ? { lossInWg: null } : { lossInWg: r.p.lossInWg };
        leg.lossInWg = t.lossInWg;
        leg.velocityFpm = r.p.velocityFpm;
        const src = r.p.source;
        leg.lossSource = !src ? leg.lossSource : lossSourceOf(src, r.note ?? "");
      }
    }
    for (const join of w.autoJoins) {
      if (
        (join.from[0] === e.id && join.from[1] === out) ||
        (join.to[0] === e.id && join.to[1] === st.in)
      ) {
        leg.lossSource.ref += `; ${join.note}`;
        this.autoJoinNotes.add(join.note);
      }
    }
    this.priced.set(id, { blockerIds: ids, p });
    return ids;
  }

  /**
   * A fitting on a leg whose flow is unknown stays in the census, unpriced, under the rule it would
   * match: the path's no-flow blockers withhold it, never a not-priced blocker of its own. Without
   * this row the census silently lost every fitting of a fan whose flow went unknown (MUAS-1 at
   * cloud Chadds r22: 44 rows to 1 after two kind rulings, 2026-10-30).
   */
  private unknownFlowRow(w: Walk, side: Side, s: number, out: number | undefined) {
    const st = w.states[s]!;
    const e = st.el;
    if (isSegment(e) || e.kind !== "fitting") return;
    const key = String(e.id);
    if (this.pricingLeg) this.onLeg(this.pricingLeg, key);
    if (this.fittings.has(key)) return;
    const conn = (i: number | undefined) => e.connectors.find((c) => c.index === i);
    const [inlet, outlet] = side === "supply" ? [conn(st.in), conn(out)] : [conn(out), conn(st.in)];
    const facts = fittingFacts({ fitting: e, inlet, outlet });
    // Elbows and transitions match on geometry alone; a junction rule reading flow ratios may not
    // match at a nominal flow, and then the row names no rule (it is priced once the flow is known).
    const rule = facts.inputError ? undefined : LOSS_RULES.find((r) => r.when(facts, { q: 1 }));
    const chosen = rule ? this.input.inputs.tables[rule.key] : undefined;
    this.fittings.set(key, {
      key,
      elementId: e.id,
      family: facts.family,
      rule: rule?.key ?? null,
      table: rule ? (chosen?.value.toUpperCase() ?? rule.table) : null,
      ruleSource: rule ? "matched" : "none",
      tableSource: rule
        ? chosen
          ? chosen.source === "stored"
            ? "stored"
            : "typed"
          : "default"
        : null,
      options: rule ? [...new Set([rule.table, ...rule.options])] : [],
      candidates: candidatesFor(facts),
      lossInWg: null,
      unpriced: "its flow is unknown",
      typed: null,
    });
  }

  private price(
    w: Walk,
    flows: Flows,
    side: Side,
    s: number,
    out: number | undefined,
    cfm: number,
  ): { p: PricedLeg | null; ids: string[]; note?: string; cfm?: number } {
    const { grids } = this.input;
    const st = w.states[s]!;
    const e = st.el;
    const drop = (inWg: number | null, source: string) => {
      const p = priceLeg({ kind: "drop", element: e as Node, cfm, inWg, source }, grids);
      return { p, ids: this.take(p, e.id).ids };
    };
    const stated = this.input.inputs.components[String(e.id)]?.drop;
    if (stated && stated.value != null) return drop(stated.value, provenance(stated));
    if (isSegment(e)) return this.duct(w, flows, side, s, out, cfm);
    const conn = (i: number | undefined) => e.connectors.find((c) => c.index === i);
    if (e.kind === "terminal") {
      const t = this.input.inputs.terminals[String(e.id)];
      return t ? drop(t.drop.value, provenance(t.drop)) : drop(null, "terminal not in inputs");
    }
    if (e.kind === "equipment") return drop(null, "inline equipment; no typed drop");
    // The resolver records a family placeholder as a stated null with its ref (Chadds' 302 dampers at 1.0).
    const placeholder = stated && stated.value == null ? stated.ref : undefined;
    if (isTap(e)) return this.tap(w, flows, side, s, cfm);
    // A tee walked in at its run: the run port faces the fan on both sides. On the return the air
    // leaves by that port, so the branch and straight converge into it.
    const tee = teePorts(e, conn(st.in));
    const converging = side === "return" && tee != null;
    const [inlet, outlet] =
      side === "supply" || converging ? [conn(st.in), conn(out)] : [conn(out), conn(st.in)];
    const through = stateFlow(flows, s);
    const branchCfm = tee ? flows.leg.get(legKey(s, tee.branch.index))?.cfm : null;
    const straightCfm = tee ? flows.leg.get(legKey(s, tee.straight.index))?.cfm : null;
    const legFlows: LegFlows =
      tee && through != null && branchCfm != null && straightCfm != null
        ? { through: cfm, branch: branchCfm, upstreamMain: through, downstreamMain: straightCfm }
        : e.connectors.length > 2 && through != null
          ? { through: cfm, branch: cfm, upstreamMain: through, downstreamMain: through - cfm }
          : { through: cfm };
    const facts = fittingFacts({ fitting: e, inlet, outlet, converging });
    if (e.partType === "Tee" && !tee) delete facts.junction;
    if (placeholder && !LOSS_RULES.some((r) => r.when(facts, ruleFlows(legFlows))))
      return drop(null, `${placeholder}; type the real drop`);
    const p = this.fit({ kind: "fitting", fitting: e, facts, flows: legFlows, leg: "C" });
    return { p, ids: this.take(p, e.id).ids };
  }

  /**
   * Price a fitting leg and record it in the census. The rule's own match prices it; where none
   * matches, the rule a person assigned its family (ducts LEDGER 2026-10-29: `ruleAssignments` by
   * family, then the rule's own match). The sheet reads an assignment only where no rule matches, so
   * closing one unmatched elbow never reprices the family's matched ones; `inputs.tables` swaps the
   * table either reads.
   */
  private fit(
    input: Extract<LegInput, { kind: "fitting" }>,
    key = String(input.fitting.id),
    proposed?: ProposedPath,
  ): PricedLeg {
    if (this.pricingLeg && !proposed) this.onLeg(this.pricingLeg, key);
    const flows = ruleFlows(input.flows);
    const matched = input.facts.inputError
      ? undefined
      : LOSS_RULES.find((r) => r.when(input.facts, flows));
    const family = input.facts.family;
    const assigned = !matched && family ? this.input.inputs.assignments[family] : undefined;
    const p = priceLeg(
      assigned ? { ...input, ruleKey: assigned.value } : input,
      this.input.grids,
      this.choices,
    );
    const src = p.source?.kind === "rule" ? p.source : null;
    const rule = src ? ruleByKey(src.rule) : assigned ? ruleByKey(assigned.value) : matched;
    const chosen = rule ? this.input.inputs.tables[rule.key] : undefined;
    // A proposed fitting is no element: its identity is its path key and pair (a transition's
    // stand-in node has no id), never a sentinel element id.
    const identity = proposed
      ? { key, elementId: null, proposed }
      : { key, elementId: input.fitting.id };
    const row: FittingPricing = {
      ...identity,
      family,
      rule: rule?.key ?? null,
      table: src?.table ?? null,
      ruleSource: matched ? "matched" : assigned ? "assigned" : "none",
      tableSource: !src
        ? null
        : chosen && chosen.value.toUpperCase() === src.table
          ? chosen.source === "stored"
            ? "stored"
            : "typed"
          : src.table === rule?.table
            ? "default"
            : "fallback",
      options: rule ? [...new Set([rule.table, ...rule.options])] : [],
      candidates: candidatesFor(input.facts),
      lossInWg: p.unpriced || p.implausible ? null : p.lossInWg,
      unpriced: p.unpriced,
      typed: null,
    };
    // One fitting may be priced on several legs; an unpriced leg is what the census must show.
    const had = this.fittings.get(key);
    if (!had || had.unpriced == null) this.fittings.set(key, row);
    return p;
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

  private duct(w: Walk, flows: Flows, side: Side, s: number, out: number | undefined, cfm: number) {
    const { grids } = this.input;
    const st = w.states[s]!;
    const duct = st.el as Segment;
    const inC = duct.connectors.find((c) => c.index === st.in);
    const outC = duct.connectors.find((c) => c.index === out);
    const ids: string[] = [];
    let pieces: { kind: "friction"; lengthFt: number; cfm: number }[] = [];
    let cs: PricedLeg[] = [];
    if (inC && inC.kind !== "curve") {
      const taps = this.tapsOn(w, flows, s);
      const upstreamCfm = stateFlow(flows, s);
      if (!taps || upstreamCfm == null) return { p: null, ids };
      const leaveBy = outC?.kind === "curve" ? (outC.connectedTo?.elementId ?? null) : null;
      const split = splitTappedDuct({ duct, upstream: inC, upstreamCfm, taps, leaveBy });
      pieces = split.filter((x) => x.kind === "friction");
      cs = split.flatMap((x) =>
        x.kind !== "tap-straight"
          ? []
          : [
              this.fit({
                kind: "fitting",
                fitting: x.tap,
                leg: "Cs",
                flows: x.flows,
                facts: fittingFacts({
                  fitting: x.tap,
                  inlet: x.tap.connectors.find((c) => c.connectedTo?.elementId === duct.id),
                  outlet: undefined,
                  main: duct,
                  // On the return the walk runs against the air: a tap passed is a branch joining.
                  converging: side === "return",
                }),
              }),
            ],
      );
    } else {
      // Entered by a tap on its side (or at a proposed tap's landing point, R-Q4): friction from
      // the tap to the connector it leaves by.
      // ponytail: taps passed on the way are not charged here; the split above covers the usual entry.
      const first = duct.connectors
        .filter((c) => c.kind !== "curve")
        .sort((a, b) => dist(a.point, duct.polyline[0]!) - dist(b.point, duct.polyline[0]!))[0];
      const pos = (c: typeof inC | undefined) =>
        !c
          ? duct.lengthFt
          : c.kind === "curve"
            ? tapDistance(
                duct,
                { id: c.connectedTo?.elementId ?? -1, point: c.point } as Node,
                first,
              )
            : dist(c.point, duct.polyline[0]!) <= dist(c.point, duct.polyline.at(-1)!)
              ? 0
              : duct.lengthFt;
      const from = inC
        ? pos(inC)
        : tapDistance(duct, { id: -1, point: st.at ?? duct.polyline[0]! } as Node, first);
      pieces = [{ kind: "friction", lengthFt: Math.abs(pos(outC) - from), cfm }];
    }
    const priced = pieces.map((x) =>
      priceLeg({ kind: "duct", segment: duct, lengthFt: x.lengthFt, cfm: x.cfm }, grids),
    );
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
      kind: "duct",
      elementId: duct.id,
      lossInWg: loss,
      velocityFpm: head?.velocityFpm ?? null,
      source: {
        kind: "friction",
        f: head?.source?.kind === "friction" ? head.source.f : 0,
        roughnessFt: duct.roughness.valueFt,
        rateInWgPer100Ft: rate,
      },
      unpriced: null,
      // Equivalent feet: the straight length, plus any Cs charged on it at this duct's own rate.
      lengthFt: rate ? (loss / rate) * 100 : length,
    };
    return {
      p,
      ids,
      note: `, ${round(length)} ft${cs.length ? `, ${cs.length} tap(s) passed (Cs)` : ""}`,
      // The flow the leg is priced at where it enters, the same piece its velocity is read from: a
      // duct left by a tap on its side carries the upstream flow up to that tap (RV-15's tap on
      // 14682079 is fed 150 cfm through 4.93 ft of the 10 in main), never the branch's 35.
      ...(head && pieces[0] ? { cfm: pieces[0].cfm } : {}),
    };
  }

  private tap(
    w: Walk,
    flows: Flows,
    side: Side,
    s: number,
    cfm: number,
  ): { p: PricedLeg | null; ids: string[]; note?: string } {
    const st = w.states[s]!;
    const tap = st.el as Node;
    const parent = w.states[st.parent]!;
    const main = isSegment(parent.el) ? parent.el : null;
    const fromSide = main && main.connectors.find((c) => c.index === st.via)?.kind === "curve";
    if (!main || !fromSide) {
      // Entered from the branch. R-Q4 split: the landing duct is a walked child, so the main's
      // flows are the ones the walk carries each way along it. Q4 merge (foreign landing): the
      // receiving stream is not this fan's to invent; its connector flow metadata, else the branch
      // is unpriced.
      const mainPort = tap.connectors.find((c) => c.index !== st.in);
      const receiving = mainPort?.connectedTo && this.g.byId.get(mainPort.connectedTo.elementId);
      const directions = (this.landingOf(w, flows, s)?.ways ?? []).map((x) => x.cfm ?? 0);
      const modelled = directions.length ? Math.max(...directions) : 0;
      const active = directions.filter((v) => v > 0);
      const total = active.reduce((a, v) => a + v, 0);
      const twoWay = active.length > 1;
      const mainCfm =
        modelled > 0
          ? modelled
          : receiving && isSegment(receiving)
            ? receiving.connectors.reduce((max, c) => Math.max(max, c.flowCfm ?? 0), 0)
            : 0;
      // Air direction at the junction: a merge on the supply is this fan's branch joining the
      // receiving main (converging); on the return the branch draws from that main (diverging).
      // A split (the landing walked by this fan) carries air along the main from the collar. On
      // the return the streams meet in the collar: a converging bullhead tee, branch 1 the larger
      // stream (ER5-5 / ED5-4). On the supply, when the collar's air divides both ways, each path is
      // its own leg (`splitShare`) at its own share of the real collar total, a diverging bullhead
      // (SD5-18, loss-rules' bullhead-diverging-round), never one leg charged on both paths at a
      // main flow invented beside the collar (MUAS-1 takeoff 14806947, fix6 4). One way along the
      // main on the supply, the same rule with one path on the tap table: Qc is the real collar
      // total, never the branch plus the main it turns into (2x the collar flow, FC-23's 13885163,
      // 9448322, 9448375; fix6, coordinator ruling 2026-10-29).
      const split = modelled > 0;
      const bullhead = split && side === "return";
      const divides = split && side === "supply";
      if (!receiving || !isSegment(receiving) || mainCfm <= 0)
        return {
          p: {
            kind: "drop",
            elementId: tap.id,
            lossInWg: null,
            velocityFpm: null,
            source: {
              kind: "drop",
              source: "merge boundary; branch loss unavailable without receiving-stream flow",
            },
            unpriced: null,
          },
          ids: [],
        };
      const p = this.fit({
        kind: "fitting",
        fitting: tap,
        leg: "Cb",
        flows: bullhead
          ? { through: cfm, branch: modelled, upstreamMain: cfm, downstreamMain: cfm - modelled }
          : divides
            ? { through: cfm, branch: cfm, upstreamMain: total, downstreamMain: total - cfm }
            : { through: cfm, branch: cfm, upstreamMain: mainCfm + cfm, downstreamMain: mainCfm },
        facts: fittingFacts({
          fitting: tap,
          inlet: tap.connectors.find((c) => c.index === st.in),
          outlet: undefined,
          main: receiving,
          converging: split ? side === "return" : side === "supply",
          // With loss-rules' bullhead-diverging-round (SD5-18), the two-way supply split is a
          // diverging bullhead per path.
          bullhead: bullhead || (divides && twoWay),
        }),
      });
      return {
        p,
        ids: this.take(p, tap.id).ids,
        ...(split
          ? {
              note: divides
                ? twoWay
                  ? `, entered from its branch; collar air divides both ways, this path ${round(cfm)} of ${round(total)} cfm`
                  : `, entered from its branch; all ${round(total)} cfm turns one way along the main`
                : ", entered from its branch and split both ways along the main",
            }
          : {}),
      };
    }
    const parentIn = main.connectors.find((c) => c.index === parent.in);
    const taps = parentIn && parentIn.kind !== "curve" ? this.tapsOn(w, flows, st.parent) : null;
    const up = stateFlow(flows, st.parent);
    const branch =
      taps && up != null
        ? splitTappedDuct({
            duct: main,
            upstream: parentIn!,
            upstreamCfm: up,
            taps,
            leaveBy: tap.id,
          }).at(-1)
        : undefined;
    const legFlows: LegFlows =
      branch?.kind === "tap-branch"
        ? branch.flows
        : { through: cfm, branch: cfm, upstreamMain: up ?? cfm, downstreamMain: (up ?? cfm) - cfm };
    const p = this.fit({
      kind: "fitting",
      fitting: tap,
      leg: "Cb",
      flows: legFlows,
      facts: fittingFacts({
        fitting: tap,
        inlet: tap.connectors.find((c) => c.index === st.in),
        outlet: undefined,
        main,
        // Walked main to branch: on the return the air runs branch to main, converging.
        converging: side === "return",
      }),
    });
    return { p, ids: this.take(p, tap.id).ids };
  }

  /** One path per end, legs priced, equivalent feet at each leg's own rate. */
  paths(w: Walk, flows: Flows, side: Side, ends: readonly End[] = w.ends): SheetPath[] {
    const uses = (e: End, h: Walk["heals"][number]) =>
      (e.state === h.state && e.out === h.out) ||
      lineage(w, e.state).some(
        (s) => w.states[s]!.parent === h.state && w.states[s]!.via === h.out,
      );
    for (const h of w.heals) {
      const values = w.ends.flatMap((e, i) => (uses(e, h) ? [flows.end[i] ?? null] : []));
      const cfm = values.some((v) => v == null)
        ? null
        : values.reduce<number>((sum, v) => sum + v!, 0);
      const sources = [
        ...new Set(
          w.ends.flatMap((e, i) => (uses(e, h) && flows.endSource[i] ? [flows.endSource[i]!] : [])),
        ),
      ];
      this.cause = h.cause;
      try {
        this.heal(w, flows, side, h, cfm, sources.join(" + "));
      } finally {
        this.cause = undefined;
      }
    }
    return ends.map((e) => {
      const legIds = legsOf(w, e);
      const chain = lineage(w, e.state);
      const blockerIds = new Set<string>(e.blockerIds);
      for (const x of this.straightRuns(w, flows, chain, legIds)) {
        legIds.splice(legIds.indexOf(x.after) + 1, 0, x.id);
        this.priced.get(x.id)?.blockerIds.forEach((b) => blockerIds.add(b));
      }
      chain.forEach((s, k) => {
        w.states[s]!.blockerIds.forEach((b) => blockerIds.add(b));
        const out = k + 1 < chain.length ? w.states[chain[k + 1]!]!.via : e.out;
        const share = this.splitShare(w, flows, side, chain, k, e) ?? undefined;
        const leg = this.leg(w, flows, side, s, out, share);
        if (share) legIds[legIds.indexOf(legId(w.states[s]!.el.id, w.states[s]!.in, out))] = leg.id;
        leg.blockerIds.forEach((b) => blockerIds.add(b));
      });
      for (const h of w.heals.filter((h) => uses(e, h))) {
        const after = h.state === 0 ? -1 : chain.indexOf(h.state);
        const id = after < 0 ? null : legsOf(w, e)[after];
        const at = id == null ? 0 : legIds.indexOf(id) + 1;
        // The extension, then the one path through its proposed fitting this end takes.
        const own = [`heal:${h.proposal.pair.join("|")}:extension`];
        const toward = this.towardOf(w, h, chain, e);
        const fitting =
          toward == null ? undefined : this.healPaths.get(h.proposal.pair.join("|"))?.get(toward);
        if (fitting) own.push(fitting);
        legIds.splice(at, 0, ...own);
        for (const l of own) this.priced.get(l)?.blockerIds.forEach((b) => blockerIds.add(b));
      }
      const priced = legIds.map((id) => this.priced.get(id)?.p ?? null);
      const eq = equivalentFeet(
        priced.map(
          (p, i) =>
            p ?? {
              kind: "drop",
              elementId: this.legs[legIds[i]!]!.elementId,
              lossInWg: null,
              velocityFpm: null,
              source: null,
              unpriced: "",
            },
        ),
      );
      legIds.forEach((id, i) => {
        const leg = this.legs[id]!;
        if (leg.equivalentFt == null && leg.lossInWg != null && eq[i] != null)
          leg.equivalentFt = round(eq[i]!);
      });
      const knownInWg = round(legIds.reduce((a, id) => a + (this.legs[id]!.lossInWg ?? 0), 0));
      return {
        side,
        legIds,
        end: e.end,
        knownInWg,
        complete: blockerIds.size === 0,
        blockerIds: [...blockerIds],
      };
    });
  }

  private heal(
    w: Walk,
    flows: Flows,
    side: Side,
    h: Walk["heals"][number],
    cfm: number | null,
    flowSource: string,
  ) {
    const { proposal } = h;
    const source = w.states[h.state]!.el;
    const key = `heal:${proposal.pair.join("|")}`;
    const note = `${proposal.kind} ${proposal.pair.join(" to ")}; ${proposal.risk}`;
    this.healNotes.add(note);
    const port = source.connectors.find((c) => c.index === proposal.from.connector)!;
    const segment = {
      ...source,
      ...port,
      id: source.id,
      lengthFt: proposal.gapIn / 12,
      roughness: isSegment(source) ? source.roughness : { valueFt: 0.0003, provenance: "assumed" },
    } as Segment;
    const p =
      cfm == null
        ? null
        : priceLeg({ kind: "duct", segment, lengthFt: proposal.gapIn / 12, cfm }, this.input.grids);
    const ids = p ? this.take(p, source.id).ids : [];
    const extension: Leg = {
      id: `${key}:extension`,
      elementId: source.id,
      kind: "duct",
      flowCfm: cfm,
      flowSource: `${flowSource || "flow unavailable"}; continued heal walk`,
      velocityFpm: p?.velocityFpm ?? null,
      lossInWg: ids.length ? null : (p?.lossInWg ?? null),
      lossSource: {
        kind: "friction",
        ref: `assumed extension, source section, ${proposal.gapIn.toFixed(3)} in; ${note}`,
      },
      equivalentFt: proposal.gapIn / 12,
    };
    this.legs[extension.id] = extension;
    this.priced.set(extension.id, { p, blockerIds: ids });
    const legs = [extension];
    const paths = new Map<number, string>();
    if (proposal.fittingChange) {
      // kaitpw 2026-10-29: a proposed tee or tap is an ordinary fitting with two sides, priced per
      // path from the flows on its main and branch, never one combined number charged on the source
      // element (which keeps its own loss). Walked from its open end, every path this fan takes
      // through it is a branch path, one per main side it continues into; the run through it is
      // priced where a fan crosses the occupied connection (`straightRuns`).
      const directions = this.healDirections(w, flows, h);
      // A transition's one direction is its landing: one straight path, keyed `>straight`.
      for (const d of directions) {
        const leg = this.proposedBranch(side, h, source, d, directions, flowSource);
        paths.set(d.toward, leg.id);
        legs.push(leg);
      }
    }
    this.healPaths.set(proposal.pair.join("|"), paths);
    proposal.assumedLegs = legs;
  }

  /**
   * The main sides a heal's branch path continues into, with this fan's flow on each: a tee's two
   * entered elements (the occupied connection's both sides), a tap's landing duct both ways along
   * its body, a join's one target.
   */
  private healDirections(w: Walk, flows: Flows, h: Walk["heals"][number]) {
    const kids = w.states.flatMap((st, i) =>
      i > 0 && st.parent === h.state && st.via === h.out ? [i] : [],
    );
    if (h.proposal.kind === "tap") {
      const landing = kids[0];
      if (landing == null) return [];
      const el = w.states[landing]!.el;
      return el.connectors.flatMap((c) =>
        flows.leg.has(legKey(landing, c.index))
          ? [
              {
                toward: c.connectedTo?.elementId ?? el.id,
                cfm: crossing(w, flows, landing, c.index),
              },
            ]
          : [],
      );
    }
    return kids.map((k) => {
      // Every leg leaving the kid; a terminal's has no out connector (`${k}>`).
      const outs = [...flows.leg.keys()]
        .filter((key) => key.startsWith(`${k}>`))
        .map((key) => key.slice(key.indexOf(">") + 1))
        .map((o) => (o === "" ? undefined : Number(o)));
      const each = outs.map((o) => crossing(w, flows, k, o));
      return {
        toward: w.states[k]!.el.id,
        cfm: each.some((v) => v == null) ? null : each.reduce<number>((a, v) => a + v!, 0),
      };
    });
  }

  /** The main element an end's path continues into past a heal's proposed fitting. */
  private towardOf(w: Walk, h: Walk["heals"][number], chain: number[], e: End): number | null {
    const at = chain.findIndex(
      (s) => w.states[s]!.parent === h.state && w.states[s]!.via === h.out,
    );
    if (at < 0) return null;
    const kid = w.states[chain[at]!]!;
    if (h.proposal.kind !== "tap") return kid.el.id;
    const out = at + 1 < chain.length ? w.states[chain[at + 1]!]!.via : e.out;
    return kid.el.connectors.find((c) => c.index === out)?.connectedTo?.elementId ?? kid.el.id;
  }

  /**
   * One branch path through a heal's proposed fitting: a takeoff whose collar is the open end's
   * section and whose main is the landing's, priced by the takeoff and junction rules (or the rule
   * a person assigned `proposed tee` / `proposed tap`) from this fan's flow on each main side. A
   * typed drop on this path stands in only where a person typed one; there is no default.
   * A proposed transition (C3: a capped landing, the cap removed) has one path, `straight`, priced
   * by the transition rules between the open end's and the landing's sections.
   */
  private proposedBranch(
    side: Side,
    h: Walk["heals"][number],
    source: Node | Segment,
    d: { toward: number; cfm: number | null },
    directions: readonly { toward: number; cfm: number | null }[],
    flowSource: string,
  ): Leg {
    const { proposal } = h;
    const pairText = proposal.pair.join(" to ");
    const straight = proposal.kind === "transition";
    const key = PROPOSED_KEY(proposal.pair, straight ? "straight" : d.toward);
    const proposed: ProposedPath = {
      pair: proposal.pair,
      kind: proposal.kind,
      path: straight ? "straight" : "branch",
      toward: straight ? null : d.toward,
    };
    const leg: Leg = {
      id: `heal:${proposal.pair.join("|")}:fitting>${d.toward}`,
      elementId: source.id,
      kind: "fitting",
      flowCfm: d.cfm,
      flowSource: `${flowSource || "flow unavailable"}; continued heal walk`,
      velocityFpm: null,
      lossInWg: null,
      lossSource: { kind: "drop", ref: "" },
      equivalentFt: null,
    };
    this.legs[leg.id] = leg;
    this.onLeg(leg.id, key);
    // The same proposal may be priced on both walks; a path some walk could not price stays shown.
    const census = (row: Partial<Omit<FittingPricing, "key" | "elementId" | "proposed">>) =>
      this.fittings.get(key)?.unpriced != null ||
      this.fittings.set(key, {
        key,
        elementId: null,
        family: `proposed ${proposal.kind}`,
        proposed,
        rule: null,
        table: null,
        ruleSource: "none",
        tableSource: null,
        options: [],
        candidates: [],
        lossInWg: null,
        unpriced: null,
        typed: null,
        ...row,
      });
    const settle = (blockerIds: string[], p: PricedLeg | null = null) =>
      this.priced.set(leg.id, { p, blockerIds });
    const typed = this.input.inputs.fittingDrops[key];
    if (typed) {
      leg.lossInWg = typed.value;
      leg.lossSource = { kind: "drop", ref: `typed ${key}` };
      census({ lossInWg: typed.value, typed: typed.value });
      settle([]);
      return leg;
    }
    if (d.cfm == null) {
      // The path's own no-flow blockers withhold it; the fitting is priced once the flow is known.
      leg.lossSource.ref = `proposed ${proposal.kind} ${pairText} branch toward ${d.toward}: flow unknown`;
      census({ unpriced: "this path's flow is unknown" });
      settle([]);
      return leg;
    }
    if (d.cfm === 0) {
      leg.lossInWg = 0;
      leg.lossSource = { kind: "default", ref: "carries none of this fan's flow" };
      census({ lossInWg: 0 });
      settle([]);
      return leg;
    }
    const unpriced = (
      reason: string,
      row: Partial<Omit<FittingPricing, "key" | "elementId" | "proposed">> = {},
    ) => {
      leg.lossSource.ref = `proposed ${proposal.kind} ${pairText} branch toward ${d.toward}: ${reason}`;
      const had = this.fittings.get(key);
      if (!had) census({ ...row, unpriced: reason });
      else if (had.unpriced == null) this.fittings.set(key, { ...had, ...row, unpriced: reason });
      settle([
        this.block({
          kind: "not-priced",
          elementId: source.id,
          connector: proposal.from.connector,
          detail: `proposed ${proposal.kind} ${pairText}, branch path toward ${d.toward}: ${reason}`,
          effectInWg: null,
          closer: { kind: "ruling", note: "price it with a table, or type this path's drop" },
          fitting: key,
        }),
      ]);
      return leg;
    };
    if (proposal.kind === "join")
      return unpriced(
        "a proposed join's turn or size change has no fitting geometry to read a table from; type its drop",
      );
    const port = source.connectors.find((c) => c.index === proposal.from.connector);
    const target = this.g.byId.get(proposal.to.elementId);
    // A tap lands on a duct body (the duct's section); a tee on an occupied connector (its section).
    const landing =
      proposal.kind === "tap"
        ? target && isSegment(target)
          ? target
          : undefined
        : target?.connectors.find((c) => c.index === proposal.to.connector);
    if (!port || !landing) return unpriced("the proposal's collar or main is not in the read");
    if (straight) {
      const t = proposedTransition(side, port, landing as typeof port, proposal.gapIn);
      const p = this.fit(
        {
          kind: "fitting",
          fitting: t.node,
          leg: "C",
          flows: { through: d.cfm },
          facts: fittingFacts({ fitting: t.node, inlet: t.inlet, outlet: t.outlet }),
        },
        key,
        proposed,
      );
      if (p.unpriced && !p.implausible) return unpriced(p.unpriced, this.fittings.get(key));
      const taken = this.take(p, source.id, key);
      leg.lossInWg = taken.lossInWg;
      leg.velocityFpm = p.velocityFpm;
      if (p.source)
        leg.lossSource = lossSourceOf(p.source, `; proposed transition ${pairText}, ${t.note}`);
      settle(taken.ids, p);
      return leg;
    }
    const collar = { ...port, index: 0, connectedTo: undefined };
    const main = {
      shape: landing.shape,
      diameterIn: landing.diameterIn,
      widthIn: landing.widthIn,
      heightIn: landing.heightIn,
    } as Segment;
    const node = {
      id: source.id,
      kind: "fitting",
      category: "Duct Fittings",
      family: `proposed ${proposal.kind}`,
      type: proposal.kind,
      partType: "Tap",
      point: proposal.to.point,
      connectors: [collar],
      facts: [{ key: "takeoff", value: 1, provenance: "assumed" }],
    } as unknown as Node;
    const active = directions.filter((x) => (x.cfm ?? 0) > 0);
    const total = active.reduce((a, x) => a + x.cfm!, 0);
    const largest = Math.max(...active.map((x) => x.cfm!));
    // One main side carrying this fan's air: the air turns between branch and main (converging on
    // the supply, the branch drawing from the main on the return). Both sides: a bullhead on the
    // return (the larger stream's Cb1, as a real takeoff entered from its branch); on the supply the
    // collar's air divides, each path read on the diverging takeoff table at its own share.
    const twoWay = active.length > 1;
    const legFlows: LegFlows = !twoWay
      ? { through: d.cfm, branch: d.cfm, upstreamMain: d.cfm, downstreamMain: 0 }
      : side === "return"
        ? { through: total, branch: largest, upstreamMain: total, downstreamMain: total - largest }
        : { through: d.cfm, branch: d.cfm, upstreamMain: total, downstreamMain: total - d.cfm };
    const p = this.fit(
      {
        kind: "fitting",
        fitting: node,
        leg: "Cb",
        flows: legFlows,
        facts: fittingFacts({
          fitting: node,
          inlet: collar,
          outlet: undefined,
          main,
          converging: twoWay ? side === "return" : side === "supply",
          bullhead: twoWay && side === "return",
        }),
      },
      key,
      proposed,
    );
    if (p.unpriced && !p.implausible) return unpriced(p.unpriced, this.fittings.get(key));
    const t = this.take(p, source.id, key);
    leg.lossInWg = t.lossInWg;
    leg.velocityFpm = p.velocityFpm;
    if (p.source)
      leg.lossSource = lossSourceOf(
        p.source,
        `; proposed ${proposal.kind} ${pairText}, branch toward ${d.toward}${
          twoWay
            ? side === "return"
              ? "; bullhead, both main sides feed it"
              : "; collar air divides both ways"
            : ""
        }`,
      );
    settle(t.ids, p);
    return leg;
  }

  private sites?: { pair: [string, string]; ends: [string, string] }[];
  /** Accepted tees: the occupied connection each replaces (both sides), from the join rulings alone. */
  private teeSites() {
    if (this.sites) return this.sites;
    const parse = (k: string) => {
      const [id, c] = k.split(":").map(Number);
      return Number.isInteger(id) && Number.isInteger(c) ? { id: id!, c: c! } : null;
    };
    this.sites = this.input.inputs.rulings.joins
      .filter((j) => j.verdict === "accept")
      .flatMap(({ pair }) => {
        for (const [a, b] of [pair, [pair[1], pair[0]]] as const) {
          const at = parse(a);
          const other = parse(b);
          const port = at && this.g.byId.get(at.id)?.connectors.find((c) => c.index === at.c);
          if (port?.connectedTo && other && this.g.byId.has(other.id))
            return [
              {
                pair: [pair[0], pair[1]] as [string, string],
                ends: [a, `${port.connectedTo.elementId}:${port.connectedTo.connector}`] as [
                  string,
                  string,
                ],
              },
            ];
        }
        return [];
      });
    return this.sites;
  }

  /**
   * The straight path through an accepted tee: a fan crossing the occupied connection the tee
   * replaces. Its branch is the other side's open end, which carries none of this fan's air, so the
   * run is passed without a Cs leg, as a real takeoff with no branch flow is (`splitTappedDuct`);
   * a typed drop on the straight path is charged where a person typed one.
   * ponytail: a fan that also reaches the branch (both paths its own) is not priced Cs here.
   */
  private straightRuns(w: Walk, flows: Flows, chain: number[], legIds: string[]) {
    const sites = this.teeSites();
    if (!sites.length) return [];
    const runs: { after: string; id: string }[] = [];
    for (let k = 1; k < chain.length; k++) {
      const parent = w.states[chain[k - 1]!]!;
      const kid = w.states[chain[k]!]!;
      const from = `${parent.el.id}:${kid.via}`;
      const into = `${kid.el.id}:${kid.in}`;
      const site = sites.find((x) => x.ends.includes(from) && x.ends.includes(into));
      if (!site) continue;
      const key = PROPOSED_KEY(site.pair, "straight");
      const id = `tee:${site.pair.join("|")}:straight`;
      const cfm = flows.leg.get(legKey(chain[k - 1]!, kid.via))?.cfm ?? null;
      const typed = this.input.inputs.fittingDrops[key];
      const loss = typed ? typed.value : cfm == null ? null : 0;
      this.legs[id] = {
        id,
        elementId: kid.el.id,
        kind: "fitting",
        flowCfm: cfm,
        flowSource: null,
        velocityFpm: null,
        lossInWg: loss,
        lossSource: typed
          ? { kind: "drop", ref: `typed ${key}` }
          : {
              kind: "default",
              ref: `proposed tee ${site.pair.join(" to ")} straight run: its branch carries none of this fan's flow, so no Cs (as a real takeoff passed)`,
            },
        equivalentFt: null,
      };
      this.priced.set(id, { p: null, blockerIds: [] });
      this.onLeg(id, key);
      this.fittings.set(key, {
        key,
        elementId: null,
        family: "proposed tee",
        proposed: { pair: site.pair, kind: "tee", path: "straight", toward: null },
        rule: null,
        table: null,
        ruleSource: "none",
        tableSource: null,
        options: [],
        candidates: [],
        lossInWg: loss,
        unpriced: null,
        typed: typed?.value ?? null,
      });
      runs.push({ after: legIds[k - 1]!, id });
    }
    return runs;
  }
}

const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));

/**
 * The flow on leg (`s`, `out`) that crossed into `s` from its parent: the leg's flow less the
 * R-SHARE draws whose junction is `s` itself. A sibling joining at `s` (the four ERVs at plenum
 * 14106988) draws its air from there out to the shared terminal; that air never crosses what feeds
 * `s`, so a proposed fitting in front of `s` carries this fan's own flow, not the section's sum.
 */
function crossing(w: Walk, flows: Flows, s: number, out: number | undefined): number | null {
  const f = flows.leg.get(legKey(s, out));
  if (!f || f.cfm == null) return f ? null : 0;
  let cfm = f.cfm;
  for (const d of flows.draws) {
    if (d.junction !== s || d.cfm == null) continue;
    const t = w.ends[d.terminal]!;
    const chain = lineage(w, t.state);
    const k = chain.indexOf(s);
    if ((k + 1 < chain.length ? w.states[chain[k + 1]!]!.via : t.out) === out) cfm -= d.cfm;
  }
  return cfm;
}

type Port = Node["connectors"][number];
/**
 * The virtual fitting a proposed transition prices (C3): one In and one Out connector in the air's
 * direction (supply leaves by the landing, return arrives through it) and an included angle taken
 * from the proposal's own geometry, the transition filling the gap it closes: per axis
 * 2 atan(|size difference| / 2 gap), the larger axis (ASHRAE SD4/SR4 use the larger angle), 180 deg
 * (abrupt) at a zero gap. That is a geometric reading of the proposal, not a type-name guess
 * (geometry.ts); a longer transition is gentler, so a person swaps the table or types the drop.
 * Equal sections state no angle and price nothing.
 */
function proposedTransition(side: Side, source: Port, landing: Port, gapIn: number) {
  const dims = (c: Port) =>
    c.shape === "round"
      ? [c.diameterIn ?? NaN, c.diameterIn ?? NaN]
      : [c.widthIn ?? NaN, c.heightIn ?? NaN];
  const [a, b] = [dims(source), dims(landing)];
  const half = Math.max(...a.map((v, i) => Math.abs(v - b[i]!) / 2));
  const angleDeg =
    Number.isFinite(half) && half > 0
      ? Math.min(180, (2 * Math.atan2(half, gapIn) * 180) / Math.PI)
      : null;
  const [inlet, outlet] = side === "supply" ? [source, landing] : [landing, source];
  const port = (c: Port, index: number, direction: "in" | "out") =>
    ({ ...c, index, direction, connectedTo: undefined }) as Port;
  const node = {
    id: 0,
    kind: "fitting",
    category: "Duct Fittings",
    family: "proposed transition",
    type: "transition",
    partType: "Transition",
    point: landing.point,
    connectors: [port(inlet, 0, "in"), port(outlet, 1, "out")],
    facts:
      angleDeg == null
        ? []
        : [{ key: "angle", value: +angleDeg.toFixed(1), unit: "deg", provenance: "assumed" }],
  } as unknown as Node;
  return {
    node,
    inlet: node.connectors[0],
    outlet: node.connectors[1],
    note: `angle ${angleDeg == null ? "none" : angleDeg.toFixed(1)} deg assumed from the ${gapIn.toFixed(2)} in gap it fills`,
  };
}

function totals(pricer: Pricer, paths: SheetPath[], allowanceInWg: number): SideTotals {
  const complete = paths.length > 0 && paths.every((p) => p.complete);
  const worst = paths[0];
  const legs = worst ? worst.legIds.map((id) => pricer.legs[id]!) : [];
  const telFt = round(legs.reduce((a, l) => a + (l.equivalentFt ?? 0), 0));
  const worstPath = complete && worst ? worst.knownInWg : null;
  // Rate the duct and fittings actually run at: the worst path less its typed drops, over TEL.
  const drops = legs
    .filter((l) => l.lossSource.kind === "drop" || l.lossSource.kind === "default")
    .reduce((a, l) => a + (l.lossInWg ?? 0), 0);
  return {
    worstPath,
    knownInWg: worst?.knownInWg ?? 0,
    assumedInWg: worstPath,
    allowanceInWg,
    complete,
    telFt,
    frictionRatePer100:
      worstPath != null && telFt > 0 ? round(((worstPath - drops) * 100) / telFt) : null,
  };
}

/** Worst first; A-INFLOW source paths after every outlet path, since a source is never the critical run. */
const rank = (paths: SheetPath[], inflowEnds: ReadonlySet<number>) => {
  const order = new Map(paths.map((p, i) => [p, inflowEnds.has(i) ? 1 : 0]));
  return paths.sort(
    (a, b) =>
      order.get(a)! - order.get(b)! ||
      b.knownInWg - a.knownInWg ||
      a.legIds.length - b.legIds.length,
  );
};

const carrying = (e: End) =>
  e.end.kind === "terminal" || e.end.kind === "roster-fan-port" || e.end.kind === "joins-other-fan";

/** The ends choose direction; connector metadata breaks ties only. */
function endDirection(
  w: Walk,
  g: Graph,
  roster: readonly FanPort[],
): { score: number; source: string } {
  let score = 0;
  const reasons = new Set<string>();
  for (const e of w.ends) {
    const el = g.byId.get(e.end.elementId);
    if (!el) continue;
    if (e.directionHint) {
      score += e.directionHint === "supply" ? 1 : -1;
      reasons.add(
        e.directionHint === "supply"
          ? "merge toward receiving fan inlet/return"
          : "merge toward another fan discharge",
      );
      continue;
    }
    const port = el.connectors.find((c) => c.index === e.end.connector);
    const cls = (port?.classification ?? (isSegment(el) ? el.classification : null) ?? "")
      .replaceAll(" ", "")
      .toLowerCase();
    if (!isSegment(el) && e.end.kind === "terminal") {
      // Q1 (kaitpw): an outdoor louver is where outside air enters, so its side is the inlet whatever
      // else that side reaches (MUAS-1's louver plenum also feeds four ERV intakes, each a discharge vote).
      // Greenheck's stationary louver series (ESD, EDD, EDJ, EHH, ESJ, ESK) carry no "louver" word:
      // Chadds' "Greenheck Circular ESD-403" is classified Supply Air, flow in, 1120 cfm.
      if (
        /louver|louvre|outside|outdoor|intake|\b(ESD|EDD|EDJ|EHH|ESJ|ESK)-?\d/i.test(
          `${el.family ?? ""} ${el.type ?? ""}`,
        )
      ) {
        score -= 100;
        reasons.add("outdoor louver");
      } else if (/outdoor|exhaust|return/.test(cls)) {
        score--;
        reasons.add("return/exhaust terminal or outdoor intake");
      } else if (/supply/.test(cls)) {
        score++;
        reasons.add("supply terminal");
      }
    } else if (e.end.kind === "roster-fan-port" && e.end.elementId !== w.states[0]!.el.id) {
      const receiver = roster.find(
        (p) => p.unitId === e.end.elementId && p.inletPortIndex === e.end.connector,
      );
      if (receiver || /return/.test(cls) || port?.direction === "in") {
        score++;
        reasons.add("receiving fan inlet/return");
      } else if (port?.direction === "out") {
        score--;
        reasons.add("another fan discharge");
      }
    } else if (/outdoor/.test(cls)) {
      score--;
      reasons.add("outdoor-air end");
    }
  }
  // A merge into another fan's return is discharge evidence even when no terminal lies on this fan's side.

  return { score, source: [...reasons].join("; ") || "no classified end" };
}

/**
 * A side's delivered flow: the sum of its carrying outlet ends; null if any lacks one. A side
 * with no outlet (an ERV intake fed by a MUAS) carries the sum of its inflows.
 */
const sideSum = (f: Flows, w: Walk) => {
  const inflow = new Set(f.inflows.map((x) => x.end));
  const all = w.ends.map((e, i) => [e, f.end[i], i] as const).filter(([e]) => carrying(e));
  const outlets = all.filter(([, , i]) => !inflow.has(i));
  const ends = outlets.length ? outlets : all;
  return ends.some(([, v]) => v == null) ? null : ends.reduce((a, [, v]) => a + v!, 0);
};

function buildSheetPass(input: BuildSheetInput, assumeHeals: boolean): Sheet {
  const g = graphOf(input.snapshot);
  const pricer = new Pricer(input, g);
  const unit = g.byId.get(input.fan.unitId);
  if (!unit || isSegment(unit))
    throw new Error(`fan unit ${input.fan.unitId} is not in the snapshot`);
  const entry = input.roster.find(
    (p) => p.unitId === unit.id && p.portIndex === input.fan.portIndex,
  );
  const pairedInlet =
    entry?.inletPortIndex !== input.fan.portIndex
      ? entry?.inletPortIndex
      : unit.connectors.length === 2
        ? unit.connectors.find((c) => c.index !== input.fan.portIndex)?.index
        : undefined;
  const opts = {
    roster: input.roster,
    rulings: input.inputs.rulings.joins,
    endRulings: input.inputs.rulings.ends,
    assumeHeals,
    owners: foreignOwners(g, input.roster, unit),
  };
  const a = walkFrom(g, unit, input.fan.portIndex, opts);
  const b = pairedInlet == null ? null : walkFrom(g, unit, pairedInlet, opts);
  terminateMerges(a);
  if (b) terminateMerges(b);
  const aRule = endDirection(a, g, input.roster),
    bRule = b ? endDirection(b, g, input.roster) : null;
  const swap = !!bRule && bRule.score > aRule.score;
  const discharge = swap ? pairedInlet! : input.fan.portIndex;
  const inlet = swap ? input.fan.portIndex : (pairedInlet ?? null);
  const directionSource =
    bRule && aRule.score !== bRule.score
      ? `ends: discharge ${swap ? bRule.source : aRule.source}; paired side is inlet`
      : "port metadata tie-break: ends do not distinguish the paired sides";
  // The unit's own flow: typed is the side-stream exception's asserted flow, a Revit or stored value
  // its design parameter; absent both, an ordinary fan's flow is the sum of its ends (never an input).
  const unitCfm = input.inputs.units[String(unit.id)]?.cfm;
  const typedCfm = unitCfm?.source === "typed" ? unitCfm.value : null;
  const designCfm = unitCfm && unitCfm.source !== "typed" ? positive(unitCfm.value) : null;
  const terminalCfm = (id: number) => terminalCfmOf(input.inputs, id);
  const derived =
    assumeHeals && input.assumeServedFlow !== false
      ? assumedFanFlows(
          input.snapshot,
          input.roster,
          terminalCfm,
          fnv(JSON.stringify(input.inputs.terminals)),
          {
            rulings: opts.rulings,
            endRulings: opts.endRulings,
          },
        )
      : new Map();
  // An unknown assumed flow (an unbounded ERV, 0 with a line) is no flow to split: shares stay no-flow.
  const known = (f: AssumedFlow | undefined) => (f && f.cfm > 0 ? f : null);
  const assumedDesign = known(derived.get(`${unit.id}:${input.fan.portIndex}`));
  // A-INFLOW / A-COMPLETE: an ordinary fan's flow is the sum of its ends; other-fan ends are sources.
  const ordinary = designCfm == null && typedCfm == null;
  // R-SIB: other fans reached at the port that shares this side's trunk are siblings. Departs from
  // R-SIB's "ordinary fans only" (2026-10-28) under R-SHARE (ducts LEDGER 2026-10-29, receiving
  // design flows weight the split): a side-stream unit's intake shares its louver with other units'
  // inlets, and those are co-consumers drawing their own flow, not receivers of this unit's flow.
  // What still holds: a sibling never takes a share of this fan's flow.
  markSiblings(swap ? b! : a, "supply");
  if (b) markSiblings(swap ? a : b, "return");
  const flowOpts: FlowOptions = {
    terminalCfm,
    // Whatever its source: a receiving unit's design flow read from Revit weights the split exactly
    // as a typed one does (ducts LEDGER 2026-10-29). A typed 0 is a share; an untyped 0 is unset.
    unitCfm: (unitId) => {
      const u = input.inputs.units[String(unitId)]?.cfm;
      return u?.value != null && (u.source === "typed" || u.value > 0)
        ? { cfm: u.value, source: provenance(u) }
        : null;
    },
    ordinary,
    sideStream:
      typedCfm != null
        ? { cfm: typedCfm, source: "typed" }
        : designCfm == null
          ? (assumedDesign ?? null)
          : { cfm: designCfm, source: provenance(unitCfm!) },
    splitPolicy: input.inputs.criteria.splitPolicy.value,
    receivingDesignCfm: Object.fromEntries(
      Object.entries(input.inputs.units).map(([id, u]) => [Number(id), positive(u.cfm.value)]),
    ),
    receivingAssumedCfm: derived,
    siblingCfm: (fan) => {
      const u = input.inputs.units[String(fan.unitId)]?.cfm;
      if (u?.value != null && u.value > 0) return { cfm: u.value, source: provenance(u) };
      const assumed = known(derived.get(`${fan.unitId}:${fan.portIndex}`));
      return assumed ? { cfm: assumed.cfm, source: assumed.source } : null;
    },
  };
  const supply = { w: swap ? b! : a };
  const ret = b ? { w: swap ? a : b } : null;
  for (const w of [supply.w, ret?.w])
    if (w) {
      for (const [id, blocker] of w.blockers) pricer.blockers.set(id, blocker);
    }
  // A side whose one end carries nothing (an intake, an open end) carries the other side's flow;
  // so does a side whose one end is a terminal its siblings share (R-SHARE: its stated flow is a
  // cross-check). Siblings are not this fan's ends. The lone end's index, else null.
  const lone = (w: Walk) => {
    const own = w.ends.flatMap((e, i) => (e.end.kind === "sibling-fan" ? [] : [i]));
    const i = own.length === 1 ? own[0]! : null;
    return i != null && (!carrying(w.ends[i]!) || sharedTerminal(w, i)) ? i : null;
  };
  const single = (w: Walk) => lone(w) != null;
  const onSide = (w: Walk): FlowOptions =>
    designCfm == null && typedCfm == null && assumeHeals
      ? {
          ...flowOpts,
          sideStream: known(
            derived.get(`port:${unit.id}:${w === a ? input.fan.portIndex : pairedInlet}`),
          ),
        }
      : flowOpts;
  const balanced = (w: Walk, other: number | null): FlowOptions =>
    single(w) && other
      ? {
          ...onSide(w),
          only: {
            end: lone(w)!,
            cfm: other,
            source: `balance; splitPolicy:${flowOpts.splitPolicy}`,
          },
        }
      : onSide(w);
  const retFirst = !!ret && single(supply.w);
  const retFlows = ret && retFirst ? flowsOf(ret.w, onSide(ret.w), pricer.block) : null;
  const supplyFlows = flowsOf(
    supply.w,
    balanced(supply.w, retFlows ? sideSum(retFlows, ret!.w) : null),
    pricer.block,
  );
  const returnFlows = ret
    ? (retFlows ?? flowsOf(ret.w, balanced(ret.w, sideSum(supplyFlows, supply.w)), pricer.block))
    : null;
  const inflowEnds = (f: Flows) => new Set(f.inflows.map((x) => x.end));
  const supplyPaths = rank(pricer.paths(supply.w, supplyFlows, "supply"), inflowEnds(supplyFlows));
  const returnPaths = ret
    ? rank(pricer.paths(ret.w, returnFlows!, "return"), inflowEnds(returnFlows!))
    : [];
  if (!ret)
    pricer.block({
      kind: "open-end",
      elementId: unit.id,
      effectInWg: null,
      detail: `the roster names no inlet for ${unit.id}; the return side is not walked`,
      closer: {
        kind: "ruling",
        note: "check the fan's paired duct ports; no inlet could be identified",
      },
    });
  const allowance = {
    supply: input.inputs.criteria.allowanceInWg.supply.value,
    return: input.inputs.criteria.allowanceInWg.return.value,
  };
  const sT = totals(pricer, supplyPaths, allowance.supply);
  const rT = ret
    ? totals(pricer, returnPaths, allowance.return)
    : {
        worstPath: null,
        assumedInWg: null,
        knownInWg: 0,
        allowanceInWg: allowance.return,
        complete: false,
        telFt: 0,
        frictionRatePer100: null,
      };
  const required =
    sT.worstPath != null && rT.worstPath != null && sT.complete && rT.complete
      ? round(sT.worstPath + rT.worstPath + sT.allowanceInWg + rT.allowanceInWg)
      : null;
  const flowCfm = retFirst ? sideSum(returnFlows!, ret!.w) : sideSum(supplyFlows, supply.w);
  const walked = new Set<number>();
  for (const w of [supply.w, ret?.w]) if (w) for (const id of w.depth.keys()) walked.add(id);

  const note = (
    kind: SheetNote["kind"],
    text: string,
    value: SheetNote["value"] = null,
  ): SheetNote => ({
    kind,
    text,
    value,
  });
  const tagOf = (unitId: number) => input.roster.find((p) => p.unitId === unitId)?.tag;
  const notes: SheetNote[] = [
    note("direction", `inlet ${inlet ?? "none"}, discharge ${discharge}: ${directionSource}`),
    ...[...derived.entries()]
      .filter(([ref]) =>
        [unit.id, ...[...a.ends, ...(b?.ends ?? [])].map((e) => e.end.fan?.unitId)].includes(
          Number(ref.split(":")[ref.startsWith("port:") ? 1 : 0]),
        ),
      )
      .map(([ref, flow]) =>
        note("assumed-flow", `fan ${ref} cfm (assumed): ${flow.source}`, flow.cfm),
      ),
    ...[
      ...supplyFlows.inflows.map((x) => [supply.w, x] as const),
      ...(returnFlows ? returnFlows.inflows.map((x) => [ret!.w, x] as const) : []),
    ].map(([w, x]) => {
      const e = w.ends[x.end]!.end;
      const from = x.fan
        ? `${tagOf(x.fan.unitId) || "unit"} ${x.fan.unitId}:${x.fan.portIndex}`
        : "unnamed stream";
      return note(
        "inflow",
        `inflow from ${from} at ${e.elementId}${assumeHeals ? " (assumed)" : ""}: ${x.source}`,
        x.cfm,
      );
    }),
    // R-SIB: one line per sibling end, named for the fan and where it was reached.
    ...[
      ...supply.w.ends.map((e) => [e, "supply"] as const),
      ...(ret ? ret.w.ends.map((e) => [e, "return"] as const) : []),
    ]
      .filter(([e]) => e.end.kind === "sibling-fan")
      .map(([e, side]) => {
        const fan = e.end.fan!;
        return note(
          "sibling",
          `sibling ${tagOf(fan.unitId) || "unit"} ${fan.unitId}:${fan.portIndex} at ${e.end.elementId}: reached at its ${e.reached} on this fan's ${side} side; shares the trunk`,
        );
      }),
    // R-SHARE: each sibling's draw on a shared terminal, then each shared terminal's consumers
    // summed against the flow it states (a cross-check, not the source).
    ...[[supply.w, supplyFlows] as const, ...(ret ? [[ret.w, returnFlows!] as const] : [])].flatMap(
      ([w, f]) => [
        ...f.draws.map((d) => {
          const fan = w.ends[d.sibling]!.end.fan!;
          return note(
            "sibling",
            `sibling ${tagOf(fan.unitId) || "unit"} ${fan.unitId}:${fan.portIndex} draws ${d.cfm == null ? "an unknown flow" : `${round(d.cfm)} cfm`} from shared terminal ${w.ends[d.terminal]!.end.elementId}: ${d.source ?? "no design flow"}`,
            d.cfm == null ? null : round(d.cfm),
          );
        }),
        ...[...new Set(f.draws.map((d) => d.terminal))].flatMap((k) => {
          const own = f.end[k];
          const drawn = f.draws.filter((d) => d.terminal === k);
          const id = w.ends[k]!.end.elementId;
          // The flow the terminal states: its resolved design value, else Revit's own connector flow.
          // History 6 bars Revit's flow as a per-terminal source; a cross-check only reads it (the
          // Chadds louver 14088043 states 1120 there while its airflow slot is empty).
          const resolved = input.inputs.terminals[String(id)]?.cfm;
          const node = g.byId.get(id);
          const revit = node && !isSegment(node) ? slotFlowOf(node, REVIT_FLOW_SLOT).cfm : null;
          const stated: Resolved<number | null> | null =
            resolved?.value != null
              ? resolved
              : revit != null
                ? { value: revit, source: "revit", ref: "connector Flow" }
                : null;
          if (own == null || drawn.some((d) => d.cfm == null) || stated?.value == null) return [];
          const sum = round(own + drawn.reduce((a, d) => a + d.cfm!, 0));
          if (Math.abs(sum - stated.value) < 0.5) return [];
          return [
            note(
              "sibling",
              `shared terminal ${id}: consumers sum ${sum} cfm (this fan ${round(own)}, siblings ${drawn.map((d) => round(d.cfm!)).join(" + ")}); the terminal states ${stated.value} (${provenance(stated)})`,
              sum,
            ),
          ];
        }),
      ],
    ),
    // R-CAP: every open end the walk skipped on a person's capped ruling.
    ...[
      ...new Map(
        [...a.capped, ...(b?.capped ?? [])].map((c) => [`${c.elementId}:${c.connector}`, c]),
      ).values(),
    ].map((c) => note("capped", `open end ${c.elementId}:${c.connector} ruled capped`)),
    // Every auto-join the walks took, priced leg or not: a join that closes two walked stubs
    // into a loop (R-FACE) leaves no leg on any path, and is still a closure the engine took.
    ...[
      ...new Set([
        ...pricer.autoJoinNotes,
        ...[...a.autoJoins, ...(b?.autoJoins ?? [])].map((j) => j.note),
      ]),
    ].map((text) => note("auto-join", text)),
    ...[...pricer.healNotes].map((text) =>
      note("heal", `${text}: ${assumeHeals ? "assumed heal" : "accepted connector-pair ruling"}`),
    ),
    ...Object.values(pricer.legs)
      .filter((l) => l.lossSource.ref.startsWith("merge boundary"))
      .map((l) => note("merge", `merge ${l.elementId} branch loss: ${l.lossSource.ref}`)),
  ];
  // R3 (kaitpw 2026-10-28): `externalStatic` is PE_M_Fan_ExternalStaticPressure, the required ESP slot Pe writes; the page labels it "required (written)".
  const ratedEsp = input.inputs.units[String(unit.id)]?.esp.value ?? null;
  const cited = new Set([...supplyPaths, ...returnPaths].flatMap((p) => p.blockerIds));
  return {
    engineVersion: SHEET_ENGINE_VERSION,
    basis: basisOf(input.snapshot, [input.fan, inlet, input.inputs, input.assumeServedFlow]),
    fan: {
      unitId: unit.id,
      portIndex: input.fan.portIndex,
      mark: entry?.tag || unit.facts.find((f) => f.key === "mark")?.text || "",
      ratedEspInWg: ratedEsp,
      inletPortIndex: inlet,
      dischargePortIndex: discharge,
      flowCfm,
    },
    legs: pricer.legs,
    paths: [...supplyPaths, ...returnPaths],
    totals: { supply: sT, return: rT, requiredEspInWg: required, requiredEspAssumedInWg: required },
    assumed: {
      paths: [...supplyPaths, ...returnPaths],
      legs: pricer.legs,
      blockers: [...pricer.blockers.values()].filter(
        (b) => cited.has(b.id) || b.elementId === unit.id,
      ),
    },
    // Only what a path or the fan carries; a branch cut to another fan keeps its blockers off this sheet.
    blockers: [...pricer.blockers.values()].filter(
      (b) => cited.has(b.id) || b.elementId === unit.id,
    ),
    notes,
    fittings: pricer.fittingsOn([...supplyPaths, ...returnPaths]),
    walkedElementIds: [...walked].sort((a, b) => a - b),
  };
}

/** Reuse exactly the same flow/pricing rules for known and continued heal walks. */
export function buildSheet(input: BuildSheetInput): Sheet {
  const known = buildSheetPass(input, false);
  const assumed = buildSheetPass(input, true);
  known.assumed = assumed.assumed;
  known.totals.supply.assumedInWg = assumed.totals.supply.worstPath;
  known.totals.return.assumedInWg = assumed.totals.return.worstPath;
  known.totals.requiredEspAssumedInWg = assumed.totals.requiredEspInWg;
  const priced = new Map(
    [...Object.values(known.legs), ...Object.values(assumed.legs)].map((l) => [l.id, l]),
  );
  for (const b of [...known.blockers, ...known.assumed.blockers])
    if (b.proposal) {
      b.proposal.assumedLegs = [...priced.values()].filter((l) =>
        l.id.startsWith(`heal:${b.proposal!.pair.join("|")}:`),
      );
    }
  known.notes.push(...assumed.notes.filter((n) => n.kind === "heal" || n.kind === "assumed-flow"));
  // One row per fitting across both passes: the known pass's, unless the assumed pass could not
  // price it (an assumed-only blocker cites that row, so the row must say why).
  const rows = new Map(known.fittings.map((f) => [f.key, f]));
  for (const f of assumed.fittings)
    if (!rows.has(f.key) || (f.unpriced != null && rows.get(f.key)!.unpriced == null))
      rows.set(f.key, f);
  known.fittings = [...rows.values()];
  known.walkedElementIds = [
    ...new Set([...known.walkedElementIds, ...assumed.walkedElementIds]),
  ].sort((a, b) => a - b);
  return known;
}

/** One chain between an asserted start and end; priced at the typed flow; no ESP claim. */
export function buildChain(input: BuildChainInput): Chain {
  const g = graphOf(input.snapshot);
  const pricer = new Pricer(input, g);
  const start = g.byId.get(input.start.elementId);
  if (!start) throw new Error(`start ${input.start.elementId} is not in the snapshot`);
  // ponytail: the start element is the root and is not priced; start at the unit or terminal itself.
  const w = walkFrom(g, start, input.start.connector, {
    roster: input.roster,
    rulings: input.inputs.rulings.joins,
    endRulings: input.inputs.rulings.ends,
    owners: foreignOwners(g, input.roster, start),
  });
  for (const [id, b] of w.blockers) pricer.blockers.set(id, b);
  terminateMerges(w);
  let at = w.ends.findIndex((e) => e.end.elementId === input.end.elementId);
  if (at < 0) {
    const s = w.states.findIndex((st, i) => i > 0 && st.el.id === input.end.elementId);
    if (s > 0 && !lineage(w, s).some((k) => w.states[k]!.merge)) {
      const el = w.states[s]!.el;
      w.ends.push({
        state: s,
        out: undefined,
        blockerIds: [],
        end: {
          kind: !isSegment(el) && el.kind === "terminal" ? "terminal" : "open-end",
          elementId: el.id,
        },
      });
      at = w.ends.length - 1;
    }
  }
  let path: SheetPath | null = null;
  if (at < 0)
    pricer.block({
      kind: "open-end",
      elementId: input.end.elementId,
      effectInWg: null,
      detail: `${input.end.elementId} is not reached from ${input.start.elementId} under the walk's stop rules`,
      closer: { kind: "ruling", note: "check the start connector, or rule the stops between" },
    });
  else {
    const flows = flowsOf(
      w,
      { terminalCfm: () => null, only: { end: at, cfm: input.flowCfm ?? null, source: "typed" } },
      pricer.block,
    );
    path = pricer.paths(w, flows, input.direction, [w.ends[at]!])[0]!;
  }
  const legs: Record<string, Leg> = {};
  for (const id of path?.legIds ?? []) legs[id] = pricer.legs[id]!;
  return {
    engineVersion: SHEET_ENGINE_VERSION,
    basis: basisOf(input.snapshot, [
      input.start,
      input.end,
      input.direction,
      input.flowCfm,
      input.inputs,
    ]),
    start: input.start,
    direction: input.direction,
    path,
    legs,
    blockers: [...pricer.blockers.values()].filter((b) => !path || path.blockerIds.includes(b.id)),
    notes: [...pricer.autoJoinNotes].map((text) => ({
      kind: "auto-join" as const,
      text,
      value: null,
    })),
    fittings: path ? pricer.fittingsOn([path]) : [...pricer.fittings.values()],
    walkedElementIds: [...w.depth.keys()].sort((a, b) => a - b),
  };
}
