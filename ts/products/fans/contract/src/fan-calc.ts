/**
 * The fan sheet (docs/features/ducts/MAP.md, Data model): one per roster fan port, recomputed on
 * every read, never persisted. Legs are keyed once; paths are leg-id lists from the fan outward.
 * The wire contract (W1-F) mirrors this file; change it there in the same commit.
 */

export const CALC_ENGINE_VERSION = "calc/1";
export const CALC_DETAIL_READ = "fans.calc-detail";

import type {
  Encounter,
  FanBlockerKind,
  FanEspValues,
  FanIssue,
  LegEvidence,
} from "@pe/agent-contracts";


/** A roster entry's identity. Reached ends decide the physical discharge/inlet in the sheet. */
export interface FanPortRef {
  unitId: number;
  portIndex: number;
}

export type LegKind = "duct" | "fitting" | "accessory" | "equipment" | "terminal";

export interface Leg {
  /** `${elementId}:${in}>${out}` in walk order (from the fan); an absent side is empty. */
  id: string;
  elementId: number;
  kind: LegKind;
  /** Walk order, not air order: on the return side air leaves by `inConnector`. */
  inConnector?: number;
  outConnector?: number;
  flowCfm: number | null;
  /** e.g. `terminals:3`, `side-stream:typed`; null with no flow. */
  flowSource: string | null;
  velocityFpm: number | null;
  /** Null when unpriced or implausible; the reason is a blocker naming this element. */
  lossInWg: number | null;
  lossSource: { kind: "friction" | "rule" | "drop" | "default"; ref: string };
  /** At this leg's own rate (duct and fitting legs only); typed drops stay in in-wg. */
  equivalentFt: number | null;
  /** What the loss was computed from, typed (L2-1); `lossSource.ref` is display text only. */
  evidence: LegEvidence;
}

export interface PathEnd {
  /**
   * R-SIB (kaitpw/counsel 2026-10-28): `sibling-fan` is a named roster fan reached at its inlet on
   * this fan's return side, or at its discharge on its supply side: a sibling sharing the trunk.
   * Its path is priced to the junction only, carries 0 cfm and raises no blocker.
   */
  kind: "terminal" | "open-end" | "roster-fan-port" | "joins-other-fan" | "sibling-fan";
  elementId: number;
  connector?: number;
  /** The other fan, for roster-fan-port, joins-other-fan and sibling-fan. */
  fan?: FanPortRef | null;
  /** Which port of that fan the walk arrived at; `ENCOUNTERS` reads it. Absent when neither. */
  reached?: "inlet" | "discharge";
}

/** A person's ruling on one open end (R-CAP, kaitpw 2026-10-28): capped, so neither an end nor a blocker. */
export interface EndRuling {
  end: { elementId: number; connector: number };
  verdict: "capped";
}

export type Side = "supply" | "return";

export interface CalcPath {
  side: Side;
  legIds: string[];
  end: PathEnd;
  /** Sum of the priced legs on the path. */
  knownInWg: number;
  blockerIds: string[];
}

/** The native-owned blocker vocabulary (generated from C#); never a TS literal copy. */
export type BlockerKind = FanBlockerKind;

export interface Blocker {
  /** `${kind}:${elementId}` plus `:${connector}` when one is named. */
  id: string;
  kind: BlockerKind;
  elementId: number;
  /** The element as the codec's `UniqueId:` SubjectRef, minted with the blocker; absent for a stand-in with no element. */
  subject?: string;
  connector?: number;
  detail: string;
  /** Effect on the total when known (an implausible leg's number, kept out of totals). */
  effectInWg: number | null;
  closer: {
    kind: "default" | "heal" | "ruling";
    note: string;
    /** A heal or join candidate the closer would act on. */
    candidate?: {
      toElementId: number;
      toConnector: number | null;
      gapIn: number;
      pair: [string, string];
    };
    /**
     * A vacant facing port of another air class within reach. Never joined silently; carried so a
     * person can choose it (an accept ruling on `pair`) beside the same-class `candidate`.
     */
    crossing?: {
      toElementId: number;
      toConnector: number;
      distanceIn: number;
      classes: [string, string];
      pair: [string, string];
    };
  };
  /** The other fan a shared leg or a join belongs to. */
  owner?: FanPortRef;
  proposal?: HealProposal;
  /**
   * R-B (kaitpw 2026-10-28): the id of the open-end blocker whose assumed heal first exposed this
   * one. A consequence of the heal, not an independent gap; set only in the assumed pass.
   */
  causedBy?: string;
  /** A not-priced fitting's census row (`Sheet.fittings`), by key: what a person prices it with. */
  fitting?: string;
}

/** How one fitting, or one path through a proposed fitting, is priced (the wire type, W1-F). */
export type FittingPricing = import("@pe/agent-contracts").FittingPricing;

/** A calculation assumption, never a model write. Points use snapshot coordinates (feet). */
export interface HealProposal {
  kind: "join" | "tap" | "tee" | "transition";
  from: { elementId: number; connector: number; point: number[] };
  to: { elementId: number; connector: number | null; point: number[] };
  pair: [string, string];
  gapIn: number;
  fittingChange: boolean;
  /** The end cap a `transition` removes from the occupied target connector (C3, 2026-10-29). */
  replaces?: { elementId: number };
  risk: string;
  /** Extension friction and any required fitting change, priced on the continued walk. */
  assumedLegs: Leg[];
}

export interface SideTotals {
  /** Worst path, in-wg; null when any path on the side has a blocker or an unpriced leg. A pricing subtotal: `Sheet.claim` alone says whether the calc is complete. */
  worstPath: number | null;
  /** Worst known subtotal across the side's paths, complete or not. */
  knownInWg: number;
  /** Worst path on the continued heal walk; null while flow or pricing remains blocked. */
  assumedInWg: number | null;
  allowanceInWg: number;
  /** Total equivalent length of the worst path, ft. */
  telFt: number;
  /** ASP x 100 / TEL on the worst path; null without a worst path. */
  frictionRatePer100: number | null;
}

/** A closure or reading the engine took on its own (a direction, an auto-join, an assumed heal): shown, never parsed. */
export type CalcNote = import("@pe/ducts-contract/duct-inputs").CalcNote;

export interface Calc {
  engineVersion: string;
  /** Hash of snapshot identity + rulings + defaults + engine version. */
  basis: string;
  fan: FanPortRef & {
    mark: string;
    /** The return-side start; null when the roster names none. */
    inletPortIndex: number | null;
    /** Physical discharge after the ends decide direction; portIndex remains the roster identity. */
    dischargePortIndex: number;
    /**
     * Q4: the family's connector direction set the roles and the network's ends read the other way.
     * Raised as the blocking issue `direction-mismatch:<unit>`; null when they agree or the family states none.
     */
    directionMismatch: { discharge: number; networkDischarge: number; evidence: string } | null;
    /** A stated flow when one is authored; otherwise the sum its ends carry, a result (Q1 B). */
    flowCfm: number | null;
  };
  legs: Record<string, Leg>;
  /** Ranked worst first per side, supply first. */
  paths: CalcPath[];
  /** The one authority on completeness and required ESP (invariant 1). */
  claim: import("./fans-inputs.ts").FanClaim;
  /** Rated ESP and the computed required claim have independent sources (P-030). */
  esp: FanEspValues;
  /** Every other fan this fan's air meets, each under its `ENCOUNTERS` row. */
  encounters: Encounter[];
  /** One typed row per blocker and warning, by the blocker's id; closers are data, never prose. */
  issues: FanIssue[];
  /** Hash of the snapshot and inputs every fan's sheet of one read shares; a host calc at another is stale. */
  network: string;
  totals: {
    supply: SideTotals;
    return: SideTotals;
    /** `claim.requiredEspInWg` when the claim is complete, else null. */
    requiredEspInWg: number | null;
    requiredEspAssumedInWg: number | null;
  };
  /** Continued walk, including newly exposed ends and blockers; never substituted for known. */
  assumed: { paths: CalcPath[]; legs: Record<string, Leg>; blockers: Blocker[] };
  blockers: Blocker[];
  notes: CalcNote[];
  /** Every fitting priced (or not) on either pass, with its rule, table and their sources. */
  fittings: FittingPricing[];
  walkedElementIds: number[];
}

/** Chain mode: one path between an asserted start and end, in the sheet's shape, with no ESP claim. */
export interface Chain {
  engineVersion: string;
  basis: string;
  start: { elementId: number; connector?: number };
  /** `supply`: air flows from start to end; `return`: from end to start. */
  direction: Side;
  /** Null when the end is not reached; the blockers say why. */
  path: CalcPath | null;
  legs: Record<string, Leg>;
  blockers: Blocker[];
  notes: CalcNote[];
  fittings: FittingPricing[];
  walkedElementIds: number[];
}
