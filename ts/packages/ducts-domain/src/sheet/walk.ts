/**
 * The per-side walk (MAP step 3, W0-A's binding rules): BFS over connectors from one fan
 * connector. Stops at any roster unit (nothing credited from it), a terminal, an open end, or
 * equipment that is not a 2-port inline part. Inferred joins only to vacant opposed ports.
 * Revit direction never chooses an edge; class changes mark stream merges. R-Q4 (kaitpw
 * 2026-10-28): a tap entered from its branch is a merge only when its landing is on another roster
 * fan's network (`foreignOwners`); on this fan's own or an unowned duct it is a split, walked on
 * through the landing duct in both directions. An open end's neighbourhood is C#'s model health
 * (`snapshot.issues`, ducts LEDGER 2026-10-29): the walk reads it and decides, never measures.
 */
import { isTap } from "../kernel/fitting-facts.ts";
import type { FanPort } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import {
  applyConnectorPairRulings,
  candidatesOf,
  classOf,
  connectorKey,
  nearOf,
  type ConnectorPairRuling,
  type Element,
  type Near,
} from "../kernel/inferred-joins.ts";
import type { Blocker, EndRuling, FanPortRef, HealProposal, PathEnd, Side } from "./types.ts";
import { proposeHeals, rulingFor } from "./heal.ts";

type Connector = Element["connectors"][number];

export interface Graph {
  all: readonly Element[];
  byId: ReadonlyMap<number, Element>;
  /** Each open end's neighbourhood, measured by C# (model health, ducts LEDGER 2026-10-29). */
  near: ReadonlyMap<string, Near>;
  /** The tolerances the neighbourhood was measured under (`snapshot.tolerances`, C#'s one home), in. */
  candidateBoxIn: number | null;
  autoJoinGapIn: number | null;
}
export const graphOf = (
  s: Pick<DuctSnapshot, "nodes" | "segments"> &
    Partial<Pick<DuctSnapshot, "issues" | "tolerances">>,
): Graph => {
  const all = [...s.nodes, ...s.segments];
  return {
    all,
    byId: new Map(all.map((e) => [e.id, e])),
    near: nearOf(s.issues),
    candidateBoxIn: s.tolerances?.candidateBoxIn ?? null,
    autoJoinGapIn: s.tolerances?.autoJoinGapIn ?? null,
  };
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
  /** The roster fan whose network a branch-tap merge lands on (R-Q4); names the end when nothing beyond does. */
  mergeOwner?: FanPort;
  /** Entry point on a duct body reached through a proposed tap (R-Q4 split): `in` is undefined. */
  at?: number[];
  /** R-B: set on every state first reached through an assumed heal; inherited by its children. */
  causedBy?: string;
}

/** A path end: legs are the ancestors of `state` (root excluded), the last leaving by `out`. */
export interface End {
  state: number;
  out: number | undefined;
  end: PathEnd;
  blockerIds: string[];
  directionHint?: "supply" | "return";
  /** Which port of the named fan the walk arrived at (R-SIB decides siblings from it). */
  reached?: "inlet" | "discharge";
}

export interface Walk {
  states: State[];
  ends: End[];
  blockers: Map<string, Blocker>;
  /** Element id -> hop depth, stop elements included (a fan or equipment the walk ended at). */
  depth: Map<number, number>;
  /** Arrivals at an element already entered (a loop or a second route); not walked again. */
  rejoins: number;
  autoJoins: {
    from: readonly [number, number];
    to: readonly [number, number];
    gapIn: number;
    note: string;
  }[];
  /** `cause`: the known pass's blocker id at the healed end, when the heal is assumed rather than ruled (R-B). */
  heals: { proposal: HealProposal; state: number; out: number; cause?: string }[];
  /** Open ends a person ruled capped (R-CAP): neither ends nor blockers. */
  capped: { elementId: number; connector: number }[];
}

export interface WalkOptions {
  roster: readonly FanPort[];
  rulings?: readonly ConnectorPairRuling[];
  endRulings?: readonly EndRuling[];
  assumeHeals?: boolean;
  /** Elements on another roster fan's network (`foreignOwners`); a tee or tap may not land on one (R-A). */
  owners?: ReadonlyMap<number, FanPort>;
}

/**
 * R-A (kaitpw 2026-10-28): every element reachable from another roster fan's ports through
 * connected connectors, and not from `unit`'s own, keyed to the roster fan the fewest hops away
 * (an ERV ducted into a fan coil's return shares its component; the nearer fan names the duct),
 * ties by roster order. One flood per build; the snapshot is the walked set plus candidate boxes.
 */
export function foreignOwners(
  g: Graph,
  roster: readonly FanPort[],
  unit: Element,
): Map<number, FanPort> {
  const flood = (from: number) => {
    const hops = new Map<number, number>([[from, 0]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      const d = hops.get(id)! + 1;
      for (const c of g.byId.get(id)?.connectors ?? []) {
        const to = c.connectedTo?.elementId;
        if (to != null && !hops.has(to)) {
          hops.set(to, d);
          queue.push(to);
        }
      }
    }
    return hops;
  };
  const own = flood(unit.id);
  const owners = new Map<number, { port: FanPort; hops: number }>();
  const units = new Map<number, FanPort>();
  for (const p of roster) if (p.unitId !== unit.id && !units.has(p.unitId)) units.set(p.unitId, p);
  for (const [id, port] of units) {
    if (own.has(id)) continue; // shares this fan's network; a landing there is not a merge
    for (const [e, hops] of flood(id)) {
      const prior = owners.get(e);
      if (!prior || hops < prior.hops) owners.set(e, { port, hops });
    }
  }
  return new Map([...owners].map(([e, o]) => [e, o.port]));
}

export const legId = (elementId: number, inC: number | undefined, out: number | undefined) =>
  `${elementId}:${inC ?? ""}>${out ?? ""}`;

/** The roster entry a walk reached at `connector` of unit `unitId`: the port, else its inlet, else the first. */
export function rosterRef(
  roster: readonly FanPort[],
  unitId: number,
  connector: number | undefined,
): FanPortRef | null {
  const own = roster.filter((p) => p.unitId === unitId);
  const hit =
    own.find((p) => p.portIndex === connector) ??
    own.find((p) => p.inletPortIndex === connector) ??
    own[0];
  return hit ? { unitId: hit.unitId, portIndex: hit.portIndex } : null;
}

/** Which roster port of `unitId` `connector` is: its discharge (the roster port), its inlet, or neither. */
export const reachedPort = (
  roster: readonly FanPort[],
  unitId: number,
  connector: number | undefined,
): End["reached"] =>
  roster.some((p) => p.unitId === unitId && p.portIndex === connector)
    ? "discharge"
    : roster.some((p) => p.unitId === unitId && p.inletPortIndex === connector)
      ? "inlet"
      : undefined;

/** Nearest measured neighbour of an open end, occupied or vacant, port or duct body, in what the graph holds. */
function nearestOf(near: Near | undefined, g: Graph, withinIn: number) {
  const choices: { label: string; gapIn: number; state: string }[] = [];
  for (const p of near?.ports ?? []) {
    const c = g.byId.get(p.elementId)?.connectors.find((x) => x.index === p.connector);
    if (c)
      choices.push({
        label: connectorKey(p.elementId, p.connector),
        gapIn: p.gapIn,
        state: c.connectedTo ? "occupied" : "vacant",
      });
  }
  for (const body of near?.bodies ?? [])
    if (g.byId.has(body.segmentId))
      choices.push({
        label: `${body.segmentId} duct body`,
        gapIn: body.gapIn,
        state: "occupied surface (no vacant port)",
      });
  return choices.filter((c) => c.gapIn <= withinIn).sort((x, y) => x.gapIn - y.gapIn)[0];
}

/** Walk from `connector` of `unit` outward. */
export function walkFrom(
  g: Graph,
  unit: Element,
  connector: number | undefined,
  opts: WalkOptions,
): Walk {
  const rosterUnits = new Set(opts.roster.map((p) => p.unitId));
  // The read's candidate box (C#, one home); a read without health measured no neighbourhood.
  const searchIn = g.candidateBoxIn ?? 0;
  const autoJoins: Walk["autoJoins"] = [];
  const heals: Walk["heals"] = [];
  const capped: Walk["capped"] = [];
  const joinedPorts = new Set<string>();
  const states: State[] = [
    { el: unit, in: undefined, parent: -1, via: undefined, depth: 0, cls: null, blockerIds: [] },
  ];
  const ends: End[] = [];
  const blockers = new Map<string, Blocker>();
  const depth = new Map<number, number>([[unit.id, 0]]);
  const entered = new Set<number>([unit.id]);
  let rejoins = 0;

  const block = (b: Omit<Blocker, "id">, causedBy?: string) => {
    const id = `${b.kind}:${b.elementId}${b.connector == null ? "" : `:${b.connector}`}`;
    if (!blockers.has(id)) blockers.set(id, { id, ...b, ...(causedBy ? { causedBy } : {}) });
    return id;
  };
  const end = (
    state: number,
    out: number | undefined,
    e: PathEnd,
    blockerIds: string[] = [],
    reached?: End["reached"],
  ) => ends.push({ state, out, end: e, blockerIds, ...(reached ? { reached } : {}) });

  const queue: number[] = [];
  const exits = (s: State) => s.el.connectors.filter((o) => o.index !== s.in);

  const enter = (
    e: Element,
    ci: number | undefined,
    parent: number,
    via: number,
    carry: string[],
    cause?: string,
    at?: number[],
  ) => {
    const p = states[parent]!;
    const d = p.depth + 1;
    const causedBy = cause ?? p.causedBy;
    if (!depth.has(e.id)) depth.set(e.id, d);
    if (rosterUnits.has(e.id) || e.id === unit.id) {
      const fan = rosterRef(opts.roster, e.id, ci) ?? { unitId: e.id, portIndex: ci ?? 0 };
      return end(
        parent,
        via,
        { kind: "roster-fan-port", elementId: e.id, connector: ci ?? 0, fan },
        carry,
        reachedPort(opts.roster, e.id, ci),
      );
    }
    if (entered.has(e.id)) return void rejoins++;
    entered.add(e.id);
    const c = e.connectors.find((x) => x.index === ci);
    if (!isSegment(e) && e.kind === "cap") return; // sealed: no air leaves by a cap
    if (!isSegment(e) && e.kind === "equipment" && e.connectors.length !== 2) {
      const id = block(
        {
          kind: "equipment-pairing",
          elementId: e.id,
          connector: ci,
          effectInWg: null,
          detail: `${e.family ?? "equipment"} ${e.id} has ${e.connectors.length} duct connectors and is not a roster fan; which one air leaves by is not known`,
          closer: {
            kind: "ruling",
            note: `rule a connector pair through ${e.id}, or confirm it as a roster fan`,
          },
        },
        causedBy,
      );
      return end(parent, via, { kind: "open-end", elementId: e.id, connector: ci }, [...carry, id]);
    }
    const blockerIds = [...carry];
    const cls = classOf(c?.classification) ?? p.cls;
    const branchTap =
      !isSegment(e) &&
      isTap(e) &&
      (!isSegment(p.el) || p.el.connectors.find((port) => port.index === via)?.kind !== "curve");
    // R-Q4: the landing (the tap's other port) decides; own or unowned is a split, walked on.
    const landing = branchTap
      ? e.connectors.find((x) => x.index !== ci)?.connectedTo?.elementId
      : undefined;
    const mergeOwner = landing == null ? undefined : opts.owners?.get(landing);
    const terminal = !isSegment(e) && e.kind === "terminal";
    // Not a re-detection of C#'s air-type-change (ruling 2026-10-29): the class carried along this
    // path (inherited through unclassified parts) decides where this fan's stream ends, a calc call.
    const merge = mergeOwner
      ? ("branch-tap" as const)
      : !terminal && p.cls && cls && cls !== p.cls
        ? ("class-change" as const)
        : undefined;
    states.push({
      el: e,
      in: ci,
      parent,
      via,
      depth: d,
      cls,
      blockerIds,
      ...(merge ? { merge } : {}),
      ...(mergeOwner ? { mergeOwner } : {}),
      ...(causedBy ? { causedBy } : {}),
      ...(at ? { at } : {}),
    });
    const s = states.length - 1;
    if (!isSegment(e) && e.kind === "terminal")
      return end(s, undefined, { kind: "terminal", elementId: e.id, connector: ci });
    queue.push(s);
  };

  const leave = (s: number, c: Connector) => {
    const st = states[s]!;
    const to = c.connectedTo;
    if (to) {
      const target = g.byId.get(to.elementId);
      if (target) return enter(target, to.connector, s, c.index, []);
      const id = block(
        {
          kind: "open-end",
          elementId: st.el.id,
          connector: c.index,
          effectInWg: null,
          detail: `${st.el.id}:${c.index} connects to ${to.elementId}:${to.connector}, which the snapshot does not hold`,
          closer: { kind: "default", note: "re-read with the element in scope" },
        },
        st.causedBy,
      );
      return end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
    }
    const effectivePort =
      !classOf(c.classification) && st.cls ? { ...c, classification: st.cls } : c;
    const open = {
      k: connectorKey(st.el.id, c.index),
      id: st.el.id,
      index: c.index,
      cls: classOf(effectivePort.classification),
    };
    const measured = g.near.get(open.k);
    // The far side of a join already taken from the other end (a walked pair, R-FACE): not an end.
    if (joinedPorts.has(open.k)) return;
    // R-CAP: a person ruled this open end capped; it is neither an end nor a blocker.
    if (opts.endRulings?.some((r) => r.end.elementId === st.el.id && r.end.connector === c.index)) {
      capped.push({ elementId: st.el.id, connector: c.index });
      return;
    }
    const rawCandidates = candidatesOf(open, measured, g.byId).filter(
      (candidate) =>
        candidate.toConnector == null ||
        !joinedPorts.has(`${candidate.toElement}:${candidate.toConnector}`),
    );
    // R-FACE (kaitpw 2026-10-28): a vacant port on a walked element may still be joined (two stubs
    // of one run reached from both sides); a tap or tee onto a walked element would loop back
    // onto this fan's own feeder, so those stay excluded.
    const ranked = proposeHeals(
      st.el,
      effectivePort,
      measured,
      g.byId,
      opts.rulings ?? [],
      joinedPorts,
    ).filter((p) => p.kind === "join" || !entered.has(p.to.elementId));
    // R-A: a tee or tap onto another roster fan's network would merge streams (Q4); a join to a
    // vacant port stays allowed whoever owns it (it may be this fan's own broken run).
    const foreignOf = (p: HealProposal) =>
      p.kind === "join" ? undefined : opts.owners?.get(p.to.elementId);
    const refused = ranked.find((p) => foreignOf(p));
    const proposal = ranked.find((p) => !foreignOf(p));
    const rejected = (pair: readonly string[]) =>
      opts.rulings?.some((r) => r.verdict === "reject" && r.pair.every((p) => pair.includes(p)));
    // C#'s near miss (vacant, opposed, within the read's auto-join gap); the sheet adds its rulings and air class.
    const auto = rawCandidates.find(
      (k) => k.autoJoin && k.toConnector != null && !k.crossing && !rejected(k.pair),
    );
    const cands = applyConnectorPairRulings(rawCandidates, opts.rulings ?? []);
    const best = cands[0] ?? rawCandidates.find((k) => !rejected(k.pair));
    // A vacant facing port of another air class is never joined silently; surface the nearest one
    // so the person can choose it over the same-class candidate (accept ruling on its pair).
    const crossingCloser = (() => {
      let pick: { k: (typeof rawCandidates)[number]; port: Connector; d: number } | undefined;
      for (const k of rawCandidates) {
        if (!k.crossing || k.toConnector == null || rejected(k.pair)) continue;
        const port = g.byId.get(k.toElement)?.connectors.find((p) => p.index === k.toConnector);
        if (!port || port.connectedTo) continue;
        const d = Math.hypot(...port.point.map((v, i) => v - c.point[i]!)) * 12;
        if (d <= searchIn && (!pick || d < pick.d)) pick = { k, port, d };
      }
      if (!pick) return {};
      const target = g.byId.get(pick.k.toElement)!;
      const toCls =
        classOf(pick.port.classification) ??
        ("classification" in target ? classOf(target.classification) : null);
      return {
        crossing: {
          toElementId: pick.k.toElement,
          toConnector: pick.port.index,
          distanceIn: pick.d,
          classes: [open.cls ?? "?", toCls ?? "?"] as [string, string],
          pair: pick.k.pair,
        },
      };
    })();
    const accepted = proposal && rulingFor(proposal.pair, opts.rulings ?? []) === "accept";
    // R-B: the blocker the known pass raises at this end, which an assumed heal's consequences cite.
    const cause = `${best ? "inferred-join" : "open-end"}:${st.el.id}:${c.index}`;
    const sameAuto = proposal && auto?.pair.every((p) => proposal.pair.includes(p));
    const follow = accepted && !sameAuto ? undefined : auto;
    if (follow) {
      const targetPort = g.byId
        .get(follow.toElement)!
        .connectors.find((p) => p.index === follow.toConnector)!;
      const gapIn = Math.hypot(...targetPort.point.map((v, i) => v - c.point[i]!)) * 12;
      if (auto === follow) {
        const note = `auto-joined ${open.k} to ${follow.toElement}:${follow.toConnector} across ${gapIn.toFixed(3)} in, default \u2264${g.autoJoinGapIn} in`;
        autoJoins.push({
          from: [st.el.id, c.index],
          to: [follow.toElement, follow.toConnector!],
          gapIn,
          note,
        });
        joinedPorts.add(open.k);
        joinedPorts.add(`${follow.toElement}:${follow.toConnector}`);
      }
      return enter(g.byId.get(follow.toElement)!, follow.toConnector!, s, c.index, []);
    }
    if (proposal && (opts.assumeHeals || accepted)) {
      const target = g.byId.get(proposal.to.elementId)!;
      const healCause = accepted ? st.causedBy : (st.causedBy ?? cause);
      heals.push({ proposal, state: s, out: c.index, ...(healCause ? { cause: healCause } : {}) });
      joinedPorts.add(open.k);
      if (proposal.kind === "tap") {
        // R-Q4: R-A refused foreign landings above, so this tap lands on this fan's own or an
        // unowned duct: a split, entered at the landing point and walked on in both directions.
        return enter(target, undefined, s, c.index, [], healCause, proposal.to.point);
      }
      const targetPort = target.connectors.find((p) => p.index === proposal.to.connector)!;
      joinedPorts.add(`${target.id}:${targetPort.index}`);
      enter(target, targetPort.index, s, c.index, [], healCause);
      if (proposal.kind === "tee" && targetPort.connectedTo) {
        const across = g.byId.get(targetPort.connectedTo.elementId);
        if (across) enter(across, targetPort.connectedTo.connector, s, c.index, [], healCause);
        else {
          const id = block(
            {
              kind: "open-end",
              elementId: target.id,
              connector: targetPort.index,
              effectInWg: null,
              detail: `tee continuation ${targetPort.connectedTo.elementId} is absent from the snapshot`,
              closer: { kind: "default", note: "re-read with the occupied connection in scope" },
            },
            healCause,
          );
          end(s, c.index, { kind: "open-end", elementId: target.id, connector: targetPort.index }, [
            id,
          ]);
        }
      }
      return;
    }
    if (refused && !proposal) {
      // R-A: the nearest heal lands on another fan's network; the end stays open in both passes.
      const owner = opts.owners!.get(refused.to.elementId)!;
      const landing =
        refused.to.connector == null
          ? `${refused.to.elementId} duct body`
          : `${refused.to.elementId}:${refused.to.connector}`;
      const id = block(
        {
          kind: "open-end",
          elementId: st.el.id,
          connector: c.index,
          effectInWg: null,
          detail: `${st.el.id}:${c.index} is open; nearest candidate ${landing} at ${refused.gapIn.toFixed(3)} in is on another roster fan's network`,
          closer: {
            kind: "ruling",
            note: `nearest candidate is ${landing} on ${owner.tag || "unit"} (${owner.unitId})'s network; a ${refused.kind} there would merge streams (Q4); rule in Revit`,
          },
        },
        st.causedBy,
      );
      return end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
    }
    if (best) {
      // The target is occupied (a capped end) or a duct side: never healed silently (W0-A rule 2).
      const seg = g.byId.get(best.toElement);
      const at = best.point ?? c.point;
      const port =
        best.toConnector != null
          ? seg?.connectors.find((p) => p.index === best.toConnector)
          : seg?.connectors.reduce((a, b) =>
              Math.hypot(...b.point.map((v, k) => v - at[k]!)) <
              Math.hypot(...a.point.map((v, k) => v - at[k]!))
                ? b
                : a,
            );
      const cap = port?.connectedTo ? g.byId.get(port.connectedTo.elementId) : undefined;
      const capped = cap && !isSegment(cap) && cap.kind === "cap" ? cap : undefined;
      const gapNative = port ? Math.hypot(...port.point.map((v, k) => v - c.point[k]!)) * 12 : null;
      const id = block(
        {
          kind: "inferred-join",
          elementId: st.el.id,
          connector: c.index,
          effectInWg: null,
          detail: capped
            ? `open ${open.k} faces ${best.toElement}:${port!.index}, already capped by ${capped.id}: face gap ${best.gapIn.toFixed(3)} in, connector gap ${gapNative!.toFixed(3)} in`
            : best.toConnector == null
              ? `open ${open.k} lands on ${best.toElement} duct body at face gap ${best.gapIn.toFixed(3)} in, occupied surface (no vacant port)`
              : `open ${open.k} nearest candidate ${best.toElement}:${best.toConnector} at ${gapNative!.toFixed(3)} in, ${port?.connectedTo ? "occupied" : "vacant"}, ${best.opposed ? "opposed" : "sideways or facing unknown"}; default auto-join requires vacant opposed ports within ${g.autoJoinGapIn} in`,
          ...(proposal ? { proposal } : {}),
          closer: {
            kind: "heal",
            note: capped
              ? `remove cap ${capped.id} and connect, or rule the pair`
              : "heal the join in Revit, or rule the pair",
            candidate: {
              toElementId: best.toElement,
              toConnector: best.toConnector ?? port?.index ?? null,
              gapIn: best.gapIn,
              pair: best.pair,
            },
            ...crossingCloser,
          },
        },
        st.causedBy,
      );
      return end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
    }
    const nearest = nearestOf(measured, g, searchIn);
    const id = block(
      {
        kind: "open-end",
        elementId: st.el.id,
        connector: c.index,
        effectInWg: null,
        detail: nearest
          ? `${st.el.id}:${c.index} is open; nearest candidate ${nearest.label} at ${nearest.gapIn.toFixed(3)} in, ${nearest.state}`
          : `${st.el.id}:${c.index} is open with nothing within ${searchIn} in`,
        ...(proposal ? { proposal } : {}),
        closer: {
          kind: proposal ? "heal" : "ruling",
          note: proposal
            ? proposal.risk
            : "mark it an intended open end with a drop, or draw the continuation",
          ...crossingCloser,
        },
      },
      st.causedBy,
    );
    end(s, c.index, { kind: "open-end", elementId: st.el.id, connector: c.index }, [id]);
  };

  const start =
    connector == null ? unit.connectors : unit.connectors.filter((c) => c.index === connector);
  states[0]!.cls = classOf(start[0]?.classification);
  for (const c of start) leave(0, c);
  while (queue.length) {
    const s = queue.shift()!;
    for (const c of exits(states[s]!)) leave(s, c);
  }
  return { states, ends, blockers, depth, rejoins, autoJoins, heals, capped };
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
    if (at == null || e.end.kind !== "roster-fan-port" || e.end.elementId === w.states[0]!.el.id)
      continue;
    const prior = owners.get(at);
    if (!prior || lineage(w, e.state).length < lineage(w, prior.state).length) owners.set(at, e);
  }
  const named = (st: State): FanPortRef | null =>
    st.mergeOwner ? { unitId: st.mergeOwner.unitId, portIndex: st.mergeOwner.portIndex } : null;
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
    const owner = owners.get(at);
    const directionHint = owner?.end.fan
      ? owner.end.connector === owner.end.fan.portIndex
        ? ("return" as const)
        : ("supply" as const)
      : /supply/i.test(w.states[st.parent]!.cls ?? "") && /return/i.test(st.cls ?? "")
        ? ("supply" as const)
        : undefined;
    return [
      {
        state: branch ? at : st.parent,
        out,
        blockerIds: [],
        ...(directionHint ? { directionHint } : {}),
        ...(owner?.reached ? { reached: owner.reached } : {}),
        end: {
          kind: "joins-other-fan",
          elementId: st.el.id,
          ...(st.in == null ? {} : { connector: st.in }),
          fan: owner?.end.fan ?? named(st),
        },
      },
    ];
  });
}

/**
 * R-SIB (kaitpw/counsel 2026-10-28), ordinary fans only: a named roster fan reached at its inlet
 * on this fan's return side, or at its discharge on its supply side, shares the trunk; its draw
 * or feed is not this fan's path. The end becomes `sibling-fan`, cut back to the junction (the
 * last element some other end of this side also passes), carrying nothing and blocking nothing.
 * A fan reached at its discharge on the return side stays an inflow source (A-INFLOW).
 */
export function markSiblings(w: Walk, side: Side): void {
  const self = w.states[0]!.el.id;
  const sibling = (e: End) =>
    (e.end.kind === "roster-fan-port" || e.end.kind === "joins-other-fan") &&
    !!e.end.fan &&
    e.end.fan.unitId !== self &&
    e.reached === (side === "return" ? "inlet" : "discharge");
  const shared = new Set<number>();
  for (const e of w.ends) if (!sibling(e)) for (const s of lineage(w, e.state)) shared.add(s);
  w.ends = w.ends.map((e): End => {
    if (!sibling(e)) return e;
    const chain = lineage(w, e.state);
    const k = chain.findLastIndex((s) => shared.has(s));
    const next = chain[k + 1];
    return {
      state: k < 0 ? 0 : chain[k]!,
      out: next == null ? e.out : w.states[next]!.via,
      blockerIds: [],
      end: { ...e.end, kind: "sibling-fan" },
      ...(e.reached ? { reached: e.reached } : {}),
    };
  });
}
