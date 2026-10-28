/**
 * Flow on a walk (MAP, Flow on a path): a terminal's flow from the confirmed slot (missing is a
 * `no-flow` blocker); a leg carries the sum of the ends this fan reaches through it; a fan's own
 * flow is the sum of its ends, never an input. A side-stream unit (MUAS into a return) carries
 * its design parameter flow, split across receiving fan ports by the asserted policy.
 */
import { slotFlowOf, terminalFlow } from "../kernel/terminal-flow.ts";
import type { Blocker } from "./types.ts";
import { isSegment, lineage, type Walk } from "./walk.ts";
import type { AssumedFlow } from "./assumed-flow.ts";

export interface FlowOptions {
  slot: string;
  /** Typed flow at an end by element id: a terminal, or a roster fan port this fan feeds. */
  endCfm?: Readonly<Record<number, number>>;
  sideStream?: { cfm: number; source: string } | null;
  splitPolicy?: "even" | "proportional";
  receivingDesignCfm?: Readonly<Record<number, number | null>>;
  receivingAssumedCfm?: ReadonlyMap<string, AssumedFlow>;
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

export function flowsOf(
  w: Walk,
  opts: FlowOptions,
  block: (b: Omit<Blocker, "id">) => string,
): Flows {
  const isFanEnd = (e: Walk["ends"][number]) =>
    e.end.kind === "roster-fan-port" || e.end.kind === "joins-other-fan";
  const typedAt = (e: Walk["ends"][number]) =>
    opts.endCfm?.[e.end.elementId] ?? (e.end.fan ? opts.endCfm?.[e.end.fan.unitId] : undefined);
  const fanPorts = w.ends.filter(isFanEnd);
  const fanEnds = fanPorts.length;
  const untyped = fanPorts.filter((e) => typedAt(e) == null);
  const terminalAt = (e: Walk["ends"][number]) => {
    const node = w.states[e.state]!.el;
    return isSegment(node)
      ? null
      : terminalFlow({ override: opts.endCfm?.[node.id], confirmed: slotFlowOf(node, opts.slot) });
  };
  const terminalSum = w.ends
    .filter((e) => e.end.kind === "terminal")
    .reduce((sum, e) => sum + (terminalAt(e)?.flow ?? 0), 0);
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
  w.ends.forEach((e, i) => {
    let cfm: number | null = 0;
    let source: string | null = null;
    if (opts.only) {
      if (i === opts.only.end) [cfm, source] = [opts.only.cfm, opts.only.source];
    } else if (e.end.kind === "terminal") {
      const node = w.states[e.state]!.el;
      const t = isSegment(node)
        ? null
        : terminalFlow({
            override: opts.endCfm?.[node.id] ?? null,
            confirmed: slotFlowOf(node, opts.slot),
          });
      [cfm, source] = t?.flow != null ? [t.flow, t.source] : [null, null];
    } else if (isFanEnd(e)) {
      const typed = typedAt(e);
      const at = untyped.indexOf(e);
      const share =
        remainder != null && remainder >= 0 && at >= 0
          ? remainder * (proportional ? weights[at]! / weightSum : 1 / untyped.length)
          : null;
      [cfm, source] =
        typed != null
          ? [typed, `side-stream:typed; ${policySource} applies to remainder`]
          : share != null
            ? [
                share,
                `side-stream:${opts.sideStream!.source}; ${policySource}${proportional && receiving(e) ? `; receiving ${receiving(e)!.source}` : ""}`,
              ]
            : [null, null];
    }
    if (
      cfm == null &&
      (opts.only ? i === opts.only.end : e.end.kind === "terminal" || isFanEnd(e))
    ) {
      const terminal = e.end.kind === "terminal";
      e.blockerIds.push(
        block({
          kind: "no-flow",
          elementId: e.end.elementId,
          ...(e.end.connector == null ? {} : { connector: e.end.connector }),
          effectInWg: null,
          detail: opts.only
            ? "the chain carries no flow; type one"
            : terminal
              ? `terminal ${e.end.elementId} has no ${opts.slot} value`
              : remainder != null && remainder < 0
                ? "typed end cfm exceeds the unit design flow; no nonnegative remainder to split"
                : fanEnds === 1
                  ? `the fan's own flow into ${e.end.elementId} has no typed share or unit design-flow value`
                  : `the fan's own flow splits across ${fanEnds} receiving fan/merge ends; no unit design flow or complete typed shares are available`,
          closer: {
            kind: terminal ? "default" : "ruling",
            note: terminal
              ? `type the terminal's cfm, or confirm a better-covered airflow slot than ${opts.slot}`
              : "type the end shares, or set the unit design-flow parameter",
          },
        }),
      );
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
      if (end[i]) {
        at.ends++;
        at.sources.add(endSource[i]!);
      }
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
