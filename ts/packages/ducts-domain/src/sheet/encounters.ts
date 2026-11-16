/**
 * Where one fan's air meets another's (MAP invariant 5, rulings Q3 and H5), and the claim that
 * follows from it (invariant 1). Pure over a priced sheet: no walk, no pricing, no solver.
 */
import type { CoverageGap, Encounter, FanClaim } from "@pe/agent-contracts";
import type { FanPortRef, Leg, SheetPath, Side } from "./types.ts";

type Reached = NonNullable<SheetPath["end"]["reached"]> | "unknown";
interface Policy {
  /** The verdict with no ruling from a person. */
  verdict: Encounter["verdict"];
  /** Whether the host's static at the tie-in is added to this fan's required ESP. */
  static: "none" | "host-calc";
  /** Q3: an error on the calc and the picture whatever the verdict. */
  backflow: boolean;
}

/**
 * ENCOUNTERS: this fan's side, by the port of the other fan its air arrives at. `verdict` and
 * `static` are separate columns: a ruling changes the verdict, never what static the row carries.
 */
export const ENCOUNTERS: Readonly<Record<`${Side}>${Reached}`, Policy>> = {
  // Feeding another fan's inlet or dumping into its return: boundary static 0, no credit (Hap SB-2).
  "supply>inlet": { verdict: "accepted", static: "none", backflow: false },
  // Discharging into another fan's positive-pressure duct: backflow (Q3); its static is added (H5).
  "supply>discharge": { verdict: "unruled", static: "host-calc", backflow: true },
  // A shared intake trunk (R-SIB): total flow on the shared legs, no pressure of the other fan's.
  "return>inlet": { verdict: "accepted", static: "none", backflow: false },
  // Drawing from another fan's discharge (A-INFLOW): a source, and its pressure is no credit.
  "return>discharge": { verdict: "accepted", static: "none", backflow: false },
  // The port reached is neither its discharge nor its inlet: nobody has said what this meeting is.
  "supply>unknown": { verdict: "unruled", static: "none", backflow: false },
  "return>unknown": { verdict: "unruled", static: "none", backflow: false },
};

/** A person's verdict on one encounter, by where it sits. */
export interface EncounterRuling {
  at: { elementId: number; connector: number };
  verdict: "accepted" | "refused";
}
export const ENCOUNTER_KEY = (at: EncounterRuling["at"]) =>
  `encounter:${at.elementId}:${at.connector}`;
export const backflowId = (e: Pick<Encounter, "elementId" | "connector">) =>
  `backflow:${e.elementId}:${e.connector}`;

export interface Met {
  encounter: Encounter;
  policy: Policy;
  /** Index into the paths given. */
  path: number;
}

/** One encounter per path that ends at another fan, placed at the path's last leg (the junction). */
export function encountersOf(
  fan: FanPortRef,
  paths: readonly SheetPath[],
  legs: Readonly<Record<string, Leg>>,
  rulings: readonly EncounterRuling[] = [],
): Met[] {
  return paths.flatMap((p, path): Met[] => {
    const host = p.end.fan;
    if (!host || host.unitId === fan.unitId) return [];
    const last = legs[p.legIds.at(-1) ?? ""];
    const at = {
      elementId: last?.elementId ?? p.end.elementId,
      connector: last?.outConnector ?? p.end.connector ?? 0,
    };
    const policy = ENCOUNTERS[`${p.side}>${p.end.reached ?? "unknown"}`];
    const ruled = rulings.find(
      (r) => r.at.elementId === at.elementId && r.at.connector === at.connector,
    );
    return [
      {
        path,
        policy,
        encounter: {
          fan: { unitId: fan.unitId, portIndex: fan.portIndex },
          host: { unitId: host.unitId, portIndex: host.portIndex },
          ...at,
          side: p.side,
          verdict: ruled?.verdict ?? policy.verdict,
          static: { kind: "none" },
        },
      },
    ];
  });
}

/** What a host fan's calc says, as a tie-in reads it. */
export interface HostCalc {
  claim: FanClaim;
  network: string;
  paths: readonly SheetPath[];
  legs: Readonly<Record<string, Leg>>;
}

/**
 * H5 (MAP L1-5): the host duct's static at the tie-in is the host calc's cumulative loss from the
 * host fan to the tie-in node. Only a complete host calc at this read's basis answers; anything
 * else is a coverage gap, never a number.
 * ponytail: the tie-in duct's own leg is not apportioned to the node; legs before it are summed.
 */
export function hostStatic(
  host: HostCalc | "absent" | "cycle",
  e: Encounter,
  network: string,
): { inWg: number; basis: string } | CoverageGap {
  const gap = (kind: CoverageGap["kind"], why: string): CoverageGap => ({
    kind,
    elementId: e.elementId,
    ref: `host ${e.host.unitId}:${e.host.portIndex} ${why}`,
  });
  if (host === "cycle") return gap("cycle", "depends on this fan's own calc");
  if (host === "absent") return gap("host-calc", "has no calc");
  if (host.network !== network) return gap("host-calc", "calc is at a stale basis");
  if (host.claim.kind !== "complete") return gap("host-calc", `calc is ${host.claim.kind}`);
  for (const p of host.paths) {
    if (p.side !== "supply") continue;
    const k = p.legIds.findIndex((id) => host.legs[id]?.elementId === e.elementId);
    if (k < 0) continue;
    const losses = p.legIds.slice(0, k).map((id) => host.legs[id]?.lossInWg ?? null);
    if (losses.some((v) => v == null)) break;
    return { inWg: losses.reduce<number>((a, v) => a + v!, 0), basis: host.claim.basis };
  }
  return gap("host-calc", "calc does not reach the tie-in");
}

export interface ClaimFacts {
  basis: string;
  paths: readonly SheetPath[];
  legs: Readonly<Record<string, Leg>>;
  /** Blockers other than backflow, by id. */
  blockingIds: readonly string[];
  coverage: readonly CoverageGap[];
  met: readonly Met[];
  allowanceInWg: Record<Side, number>;
}
const SIDES: readonly Side[] = ["supply", "return"];

/**
 * The claim laws: `complete` needs no blocking issue, no lost coverage, every accepted tie-in's host
 * calc resolved to a number, and a finite nonnegative pressure. An unruled encounter on an otherwise
 * whole calc is `to-boundary`; anything missing unexpectedly is `incomplete`.
 */
export function claimOf(f: ClaimFacts): FanClaim {
  const coverage = [...f.coverage];
  const blocking = new Set(f.blockingIds);
  const tieIn = new Map<number, number>();
  for (const m of f.met) {
    const e = m.encounter;
    if (e.verdict === "refused" || (m.policy.backflow && e.verdict === "unruled"))
      blocking.add(m.policy.backflow ? backflowId(e) : ENCOUNTER_KEY(e));
    // Added once, on the path that ends there; a return tie-in carries no static row at all.
    if (e.static.kind === "host-calc") tieIn.set(m.path, e.static.inWg);
    else if (m.policy.static === "host-calc" && e.verdict === "accepted")
      coverage.push({ kind: "host-calc", elementId: e.elementId, ref: "tie-in static unresolved" });
  }
  const whole = (p: SheetPath) =>
    p.legIds.every((id) => f.legs[id]!.lossInWg != null && f.legs[id]!.flowCfm != null);
  f.paths.forEach((p) => {
    if (p.blockerIds.length) p.blockerIds.forEach((id) => blocking.add(id));
    else if (!whole(p))
      for (const id of p.legIds)
        if (f.legs[id]!.lossInWg == null || f.legs[id]!.flowCfm == null)
          coverage.push({ kind: "pricing", elementId: f.legs[id]!.elementId, ref: `leg ${id}` });
  });
  // Paths arrive ranked: a side's first is its critical run, unless a tie-in's static makes another worse.
  const worst = (side: Side) => {
    const first = f.paths.findIndex((p) => p.side === side);
    return Math.max(
      ...f.paths.flatMap((p, i) =>
        p.side === side && (i === first || tieIn.has(i)) ? [p.knownInWg + (tieIn.get(i) ?? 0)] : [],
      ),
    );
  };
  for (const side of SIDES)
    if (!f.paths.some((p) => p.side === side))
      coverage.push({ kind: "pricing", elementId: null, ref: `no ${side} path` });
  const total = SIDES.reduce(
    (a, side) => a + Math.max(0, worst(side)) + f.allowanceInWg[side],
    0,
  );
  const knownInWg = +(Number.isFinite(total) ? total : 0).toFixed(6);
  const unique = coverage.filter(
    (g, i) => coverage.findIndex((x) => x.kind === g.kind && x.ref === g.ref) === i,
  );
  const unruled = f.met.filter((m) => m.encounter.verdict === "unruled").map((m) => m.encounter);
  const boundaryIds = new Set(unruled.map(backflowId));
  if (unique.length || [...blocking].some((id) => !boundaryIds.has(id)))
    return { kind: "incomplete", basis: f.basis, knownInWg, coverage: unique, blockingIds: [...blocking] };
  if (unruled.length)
    return {
      kind: "to-boundary",
      basis: f.basis,
      knownInWg,
      boundaries: unruled as [Encounter, ...Encounter[]],
      coverage: [],
      blockingIds: [...blocking],
    };
  if (!Number.isFinite(total) || total < 0)
    return {
      kind: "incomplete",
      basis: f.basis,
      knownInWg,
      coverage: [{ kind: "pricing", elementId: null, ref: "required ESP is not a finite pressure" }],
      blockingIds: [],
    };
  return { kind: "complete", basis: f.basis, requiredEspInWg: knownInWg, coverage: [], blockingIds: [] };
}
