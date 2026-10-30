/**
 * Flow on a walk (MAP, Flow on a path): a terminal's flow from the confirmed slot (missing is a
 * `no-flow` blocker); a leg carries the sum of the ends this fan reaches through it; a fan's own
 * flow is the sum of its ends, never an input. A side-stream unit (MUAS into a return) carries
 * its design parameter flow, split across receiving fan ports by the asserted policy.
 * A-INFLOW (counsel 2026-10-28, reversible): on an ordinary fan (no side-stream design flow) an
 * end at another fan's port or merge is a source joining this stream, not an outlet: it demands
 * no share, carries the other unit's flow (parameter, else assumed served sum, else 0) on the
 * legs only it reaches, and never raises `no-flow`.
 * R-SHARE (ducts LEDGER 2026-10-29, "receiving units' design flows weight the split"): a terminal
 * beyond a sibling's junction is shared. Each sibling draws its own resolved design flow from it,
 * carried on the legs from that junction out to the terminal, so a shared section carries the sum
 * of its consumers while this fan's own legs carry only this fan's share. That share is the fan's
 * own flow where the side balances (chain mode); otherwise the terminal's stated flow less the
 * siblings' draws. The stated flow is then a cross-check (build.ts notes a disagreement).
 * Consumers only: a sibling reached at its own inlet port draws. One reached at its discharge (a
 * co-supplier into this fan's grilles) still carries nothing, as R-SIB ruled; no ruling covers it.
 */
import type { Blocker, FanPortRef } from "./types.ts";
import { isSegment, lineage, type Walk } from "./walk.ts";
import type { AssumedFlow } from "./assumed-flow.ts";

export interface FlowOptions {
  /** A terminal's resolved design flow (`inputs.terminals`); null is a `no-flow` blocker. */
  terminalCfm: (elementId: number) => number | null;
  /**
   * A unit's resolved design flow (`inputs.units[].cfm`, whatever its source: typed, stored or
   * revit), with its provenance. At the unit's own port it is the share this fan delivers there
   * (ducts LEDGER 2026-10-29, receiving units' design flows weight the split); at a merge into the
   * unit's stream it is that stream's whole flow, never this fan's share.
   */
  unitCfm?: (unitId: number) => { cfm: number; source: string } | null;
  sideStream?: { cfm: number; source: string } | null;
  splitPolicy?: "even" | "proportional";
  receivingDesignCfm?: Readonly<Record<number, number | null>>;
  receivingAssumedCfm?: ReadonlyMap<string, AssumedFlow>;
  /** Chain mode: only this end carries flow (`cfm`), every other end carries nothing. */
  only?: { end: number; cfm: number | null; source: string };
  /** A-INFLOW: the fan has no side-stream design flow, so other-fan ends are sources, not shares. */
  ordinary?: boolean;
  /** R-SHARE: a sibling consumer's resolved design flow; null when unknown (a `no-flow` on the sibling). */
  siblingCfm?: (fan: FanPortRef) => { cfm: number; source: string } | null;
}

/** R-SHARE: one sibling's draw on one shared terminal, from the sibling's junction out. */
export interface Draw {
  /** The sibling end's index, and the shared terminal end's. */
  sibling: number;
  terminal: number;
  junction: number;
  cfm: number | null;
  source: string | null;
}

export interface Inflow {
  end: number;
  fan: FanPortRef | null;
  cfm: number;
  source: string;
}

export interface Flows {
  /** Per end: cfm, or null when it needs one and has none. */
  end: (number | null)[];
  endSource: (string | null)[];
  /** Per leg key `${state}>${out}`: summed cfm, or null with the no-flow blockers that withhold it. */
  leg: Map<string, { cfm: number | null; ends: number; missing: string[]; sources: Set<string> }>;
  /** A-INFLOW sources, by end index; empty on side-stream fans and in chain mode. */
  inflows: Inflow[];
  /** R-SHARE draws, one per sibling and shared terminal. */
  draws: Draw[];
}

export const legKey = (state: number, out: number | undefined) => `${state}>${out ?? ""}`;

export function flowsOf(
  w: Walk,
  opts: FlowOptions,
  block: (b: Omit<Blocker, "id">) => string,
): Flows {
  const isFanEnd = (e: Walk["ends"][number]) =>
    e.end.kind === "roster-fan-port" || e.end.kind === "joins-other-fan";
  // A receiving unit reached at its own port takes its design flow there. One reached by a merge
  // into its stream (FC-23's 1200 cfm return, which MUAS-1's supply joins) is not this fan's
  // share: that end takes the remainder.
  const portShare = (e: Walk["ends"][number]) =>
    e.end.kind === "roster-fan-port" && e.end.fan && e.end.elementId === e.end.fan.unitId
      ? (opts.unitCfm?.(e.end.fan.unitId) ?? undefined)
      : undefined;
  const typedAt = (e: Walk["ends"][number]): number | undefined => portShare(e)?.cfm;
  const unitId = w.states[0]!.el.id;
  // A source is reached at the other fan's roster discharge port (or at an unnamed merge); an end
  // at another fan's inlet, or a landing on a foreign network, is still this fan's outlet share.
  const isSource = (e: Walk["ends"][number]) =>
    e.end.kind === "roster-fan-port"
      ? !!e.end.fan && e.end.fan.portIndex === e.end.connector
      : e.end.kind === "joins-other-fan" &&
        (e.directionHint ? e.directionHint === "return" : !e.end.fan);
  const isInflow = (e: Walk["ends"][number]) => !!opts.ordinary && !opts.only && isSource(e);
  const inflowOf = (e: Walk["ends"][number]): Omit<Inflow, "end"> => {
    const fan = e.end.fan ?? null;
    if (!fan) return { fan, cfm: 0, source: "unnamed stream; unknown; 0 assumed" };
    if (fan.unitId === unitId)
      return { fan, cfm: 0, source: "this fan's own port; unknown; 0 assumed" };
    const design = opts.unitCfm?.(fan.unitId);
    if (design) return { fan, cfm: design.cfm, source: design.source };
    const assumed = opts.receivingAssumedCfm?.get(`${fan.unitId}:${fan.portIndex}`);
    if (assumed) return { fan, cfm: assumed.cfm, source: assumed.source };
    return { fan, cfm: 0, source: "unknown; 0 assumed" };
  };
  const fanPorts = w.ends.filter((e) => isFanEnd(e) && !isInflow(e));
  const fanEnds = fanPorts.length;
  const untyped = fanPorts.filter((e) => typedAt(e) == null);
  const terminalAt = (e: Walk["ends"][number]) => {
    const node = w.states[e.state]!.el;
    return isSegment(node) ? null : opts.terminalCfm(node.id);
  };
  // R-SHARE: the terminals beyond each sibling's junction, and the sibling's draw split over them
  // by their stated flows (evenly when any is missing).
  const draws: Draw[] = [];
  w.ends.forEach((e, i) => {
    if (!consumer(e)) return;
    const shared = w.ends.flatMap((t, k) =>
      t.end.kind === "terminal" && lineage(w, t.state).includes(e.state) ? [k] : [],
    );
    if (!shared.length) return;
    const flow = opts.siblingCfm?.(e.end.fan!) ?? null;
    const stated = shared.map((k) => terminalAt(w.ends[k]!));
    const weighted = stated.every((v) => v != null && v > 0);
    const total = weighted ? stated.reduce<number>((a, v) => a + v!, 0) : shared.length;
    shared.forEach((k, n) =>
      draws.push({
        sibling: i,
        terminal: k,
        junction: e.state,
        cfm: flow ? (flow.cfm * (weighted ? stated[n]! : 1)) / total : null,
        source: flow?.source ?? null,
      }),
    );
  });
  const drawOn = (k: number) => {
    const on = draws.filter((d) => d.terminal === k);
    return on.length === 0
      ? 0
      : on.some((d) => d.cfm == null)
        ? null
        : on.reduce((a, d) => a + d.cfm!, 0);
  };
  // This fan's share of a terminal: all of it, or (shared) what the siblings leave of its stated flow.
  const shareAt = (e: Walk["ends"][number], k: number) => {
    const stated = terminalAt(e);
    const drawn = drawOn(k);
    // An unknown draw is the sibling's own `no-flow`; the terminal keeps its stated flow meanwhile.
    if (!drawn || stated == null) return stated;
    return stated >= drawn ? stated - drawn : null;
  };
  const terminalSum = w.ends.reduce(
    (sum, e, k) => sum + (e.end.kind === "terminal" ? (shareAt(e, k) ?? 0) : 0),
    0,
  );
  const typedSum = terminalSum + fanPorts.reduce((sum, e) => sum + (typedAt(e) ?? 0), 0);
  const remainder = opts.sideStream ? opts.sideStream.cfm - typedSum : null;
  const receiving = (e: Walk["ends"][number]) =>
    e.end.fan
      ? opts.receivingAssumedCfm?.get(`${e.end.fan.unitId}:${e.end.fan.portIndex}`)
      : undefined;
  const weights = untyped.map(
    (e) => opts.receivingDesignCfm?.[e.end.fan?.unitId ?? e.end.elementId] ?? receiving(e)?.cfm,
  );
  const proportional =
    opts.splitPolicy === "proportional" && weights.every((v) => v != null && v > 0);
  const weightSum = weights.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const policy = proportional ? "proportional" : "even";
  const policySource =
    opts.splitPolicy === "proportional" && !proportional
      ? "splitPolicy:proportional -> even (receiving fan design flow missing or nonpositive)"
      : `splitPolicy:${policy}`;
  const end: (number | null)[] = [];
  const endSource: (string | null)[] = [];
  const inflows: Inflow[] = [];
  w.ends.forEach((e, i) => {
    let cfm: number | null = 0;
    let source: string | null = null;
    if (opts.only) {
      if (i === opts.only.end) [cfm, source] = [opts.only.cfm, opts.only.source];
    } else if (isInflow(e)) {
      const inflow = inflowOf(e);
      inflows.push({ end: i, ...inflow });
      [cfm, source] = [inflow.cfm, `inflow:${inflow.source}`];
    } else if (e.end.kind === "terminal") {
      const flow = shareAt(e, i);
      [cfm, source] =
        flow != null
          ? [flow, drawOn(i) ? "terminal less sibling draws" : "terminal"]
          : [null, null];
    } else if (isFanEnd(e)) {
      const own = portShare(e);
      const at = untyped.indexOf(e);
      const share =
        remainder != null && remainder >= 0 && at >= 0
          ? remainder * (proportional ? weights[at]! / weightSum : 1 / untyped.length)
          : null;
      [cfm, source] =
        own != null
          ? [own.cfm, `unit design flow ${own.source}; ${policySource} applies to remainder`]
          : share != null
            ? [
                share,
                `side-stream:${opts.sideStream!.source}; ${policySource}${proportional && receiving(e) ? `; receiving ${receiving(e)!.source}` : ""}`,
              ]
            : [null, null];
    }
    if (
      cfm == null &&
      (opts.only ? i === opts.only.end : e.end.kind === "terminal" || isFanEnd(e)) &&
      !isInflow(e)
    ) {
      const terminal = e.end.kind === "terminal";
      const causedBy = w.states[e.state]!.causedBy;
      e.blockerIds.push(
        block({
          kind: "no-flow",
          elementId: e.end.elementId,
          ...(e.end.connector == null ? {} : { connector: e.end.connector }),
          ...(causedBy ? { causedBy } : {}),
          effectInWg: null,
          detail: opts.only
            ? "the chain carries no flow; type one"
            : terminal && terminalAt(e) != null
              ? `shared terminal ${e.end.elementId} states ${terminalAt(e)} cfm, less than its siblings draw (${drawOn(i) ?? "unknown"})`
              : terminal
                ? `terminal ${e.end.elementId} has no design flow: nothing typed, no load, and its airflow slot is empty`
                : remainder != null && remainder < 0
                  ? "the receiving units' design flows at their ports: their total exceeds this unit's design flow; no nonnegative remainder to split"
                  : fanEnds === 1
                    ? `the fan's own flow into ${e.end.elementId} has no typed share or unit design-flow value`
                    : `the fan's own flow splits across ${fanEnds} receiving fan/merge ends; no unit design flow or complete typed shares are available`,
          closer: {
            kind: terminal ? "default" : "ruling",
            note: terminal
              ? "type the terminal's cfm, or confirm a better-covered airflow slot in settings"
              : "type the end shares, or set the unit design-flow parameter",
          },
        }),
      );
    }
    end.push(cfm);
    endSource.push(source);
  });

  const leg: Flows["leg"] = new Map();
  // An inflow joins at the junction where its branch leaves the outlets' legs: it is carried on
  // the legs only inflows reach; the outlet legs beyond the junction already sum their terminals.
  const inflowEnds = new Set(inflows.map((x) => x.end));
  const outletKeys = new Set<string>();
  w.ends.forEach((e, i) => {
    if (inflowEnds.has(i)) return;
    const chain = lineage(w, e.state);
    chain.forEach((s, k) => {
      const out = k + 1 < chain.length ? w.states[chain[k + 1]!]!.via : e.out;
      outletKeys.add(legKey(s, out));
    });
  });
  w.ends.forEach((e, i) => {
    const chain = lineage(w, e.state);
    chain.forEach((s, k) => {
      const out = k + 1 < chain.length ? w.states[chain[k + 1]!]!.via : e.out;
      const key = legKey(s, out);
      const at = leg.get(key) ?? { cfm: 0, ends: 0, missing: [], sources: new Set<string>() };
      if (inflowEnds.has(i) && outletKeys.has(key)) {
        leg.set(key, at);
        return;
      }
      if (end[i] == null) {
        at.cfm = null;
        at.missing.push(...e.blockerIds.filter((b) => b.startsWith("no-flow:")));
      } else if (at.cfm != null) at.cfm += end[i]!;
      if (end[i]) {
        at.ends++;
        at.sources.add(endSource[i]!);
      }
      leg.set(key, at);
    });
  });
  // R-SHARE: a sibling's draw rides the legs from its junction out to the shared terminal; an
  // unknown draw withholds them with a `no-flow` on the sibling (its design flow sizes them).
  const unknown = new Map<number, string>();
  for (const d of draws) {
    const s = w.ends[d.sibling]!;
    if (d.cfm == null && !unknown.has(d.sibling)) {
      const id = block({
        kind: "no-flow",
        elementId: s.end.elementId,
        ...(s.end.connector == null ? {} : { connector: s.end.connector }),
        effectInWg: null,
        detail: `sibling ${s.end.fan!.unitId} draws from shared terminal ${w.ends[d.terminal]!.end.elementId}; its design flow is unknown`,
        closer: {
          kind: "ruling",
          note: "set the unit design-flow parameter, or type the unit's flow",
        },
      });
      s.blockerIds.push(id);
      unknown.set(d.sibling, id);
    }
    const chain = lineage(w, w.ends[d.terminal]!.state);
    const from = chain.indexOf(d.junction);
    chain.forEach((st, k) => {
      if (k < from) return;
      const out = k + 1 < chain.length ? w.states[chain[k + 1]!]!.via : w.ends[d.terminal]!.out;
      const at = leg.get(legKey(st, out))!;
      if (d.cfm == null) {
        at.cfm = null;
        at.missing.push(unknown.get(d.sibling)!);
      } else if (at.cfm != null) at.cfm += d.cfm;
      at.sources.add(`sibling ${s.end.fan!.unitId}: ${d.source ?? "unknown"}`);
    });
  }
  return { end, endSource, leg, inflows, draws };
}

/**
 * R-SHARE: a sibling consumer is reached at its own inlet port (the stream is ducted to it; one
 * known only beyond a class change or merge, as FC-23 meets RV-7 past takeoff 13926753, is fed by
 * another stream), cut back to a junction past this fan.
 */
const consumer = (e: Walk["ends"][number]) =>
  e.end.kind === "sibling-fan" &&
  !!e.end.fan &&
  e.end.elementId === e.end.fan.unitId &&
  e.reached === "inlet" &&
  e.state !== 0;

/** R-SHARE: end `i` is a terminal some sibling consumer's junction lies on the way to. */
export const sharedTerminal = (w: Walk, i: number) =>
  w.ends[i]!.end.kind === "terminal" &&
  w.ends.some((e) => consumer(e) && lineage(w, w.ends[i]!.state).includes(e.state));

/** Flow entering state `s`: the sum over every leg leaving it (null if any is null). */
export function stateFlow(f: Flows, s: number): number | null {
  let sum = 0;
  for (const [key, v] of f.leg) {
    if (!key.startsWith(`${s}>`)) continue;
    if (v.cfm == null) return null;
    sum += v.cfm;
  }
  return sum;
}
