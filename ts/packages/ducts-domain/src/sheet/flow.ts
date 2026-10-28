/**
 * Flow on a walk (MAP, Flow on a path): a terminal's flow from the confirmed slot (missing is a
 * `no-flow` blocker); a leg carries the sum of the ends this fan reaches through it; a fan's own
 * flow is the sum of its ends, never an input. A side-stream unit (MUAS into a return) carries
 * its typed own flow at the one roster fan port it feeds.
 */
import { slotFlowOf, terminalFlow } from "../kernel/terminal-flow.ts";
import type { Blocker } from "./types.ts";
import { isSegment, lineage, type Walk } from "./walk.ts";

export interface FlowOptions {
  slot: string;
  /** Typed flow at an end by element id: a terminal, or a roster fan port this fan feeds. */
  endCfm?: Readonly<Record<number, number>>;
  sideStream?: { cfm: number; source: string } | null;
  /** Another fan's walk: the roster fan ports it reaches are not its terminals and carry nothing. */
  fanEndsCarryNone?: boolean;
  /** Chain mode: only this end carries flow (`cfm`), every other end carries nothing. */
  only?: { end: number; cfm: number | null; source: string };
}

export interface Flows {
  /** Per end: cfm, or null when it needs one and has none. */
  end: (number | null)[];
  endSource: (string | null)[];
  /** Per leg key `${state}>${out}`: summed cfm, or null with the no-flow blockers that withhold it. */
  leg: Map<string, { cfm: number | null; ends: number; missing: string[]; sources: Set<string> }>;
}

export const legKey = (state: number, out: number | undefined) => `${state}>${out ?? ""}`;

export function flowsOf(w: Walk, opts: FlowOptions, block: (b: Omit<Blocker, "id">) => string): Flows {
  const fanEnds = w.ends.filter((e) => e.end.kind === "roster-fan-port").length;
  const end: (number | null)[] = [];
  const endSource: (string | null)[] = [];
  w.ends.forEach((e, i) => {
    let cfm: number | null = 0;
    let source: string | null = null;
    if (opts.only) {
      if (i === opts.only.end) [cfm, source] = [opts.only.cfm, opts.only.source];
    } else if (e.end.kind === "terminal") {
      const node = w.states[e.state]!.el;
      const t = isSegment(node) ? null : terminalFlow({
        override: opts.endCfm?.[node.id] ?? null,
        confirmed: slotFlowOf(node, opts.slot),
      });
      [cfm, source] = t?.flow != null ? [t.flow, t.source] : [null, null];
    } else if (e.end.kind === "roster-fan-port" && !opts.fanEndsCarryNone) {
      const typed = opts.endCfm?.[e.end.elementId];
      const one = fanEnds === 1 ? opts.sideStream : null;
      [cfm, source] = typed != null ? [typed, "side-stream:typed"] : one ? [one.cfm, `side-stream:${one.source}`] : [null, null];
    }
    if (cfm == null && (opts.only ? i === opts.only.end : e.end.kind === "terminal" || (e.end.kind === "roster-fan-port" && !opts.fanEndsCarryNone))) {
      const terminal = e.end.kind === "terminal";
      e.blockerIds.push(block({
        kind: "no-flow", elementId: e.end.elementId, ...(e.end.connector == null ? {} : { connector: e.end.connector }), effectInWg: null,
        detail: opts.only
          ? "the chain carries no flow; type one"
          : terminal
            ? `terminal ${e.end.elementId} has no ${opts.slot} value`
            : fanEnds === 1
              ? `the fan's own flow into ${e.end.elementId} is not typed`
              : `the fan's own flow splits across ${fanEnds} roster fan ports; which share goes where is not known`,
        closer: {
          kind: terminal ? "default" : "ruling",
          note: terminal ? `type the terminal's cfm, or confirm a better-covered airflow slot than ${opts.slot}` : "type the side-stream cfm",
        },
      }));
    }
    end.push(cfm);
    endSource.push(source);
  });

  const leg: Flows["leg"] = new Map();
  w.ends.forEach((e, i) => {
    const chain = lineage(w, e.state);
    chain.forEach((s, k) => {
      const out = k + 1 < chain.length ? w.states[chain[k + 1]!]!.via : e.out;
      const key = legKey(s, out);
      const at = leg.get(key) ?? { cfm: 0, ends: 0, missing: [], sources: new Set<string>() };
      if (end[i] == null) {
        at.cfm = null;
        at.missing.push(...e.blockerIds.filter((b) => b.startsWith("no-flow:")));
      } else if (at.cfm != null) at.cfm += end[i]!;
      if (end[i]) { at.ends++; at.sources.add(endSource[i]!.split(":")[0]!); }
      leg.set(key, at);
    });
  });
  return { end, endSource, leg };
}

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
