/**
 * The fitting-loss rules, as data: type plus geometry condition -> ASHRAE table, the candidate
 * tables a person may stage instead, and how a fitting's facts become that table's inputs.
 * Ported from `.artifacts/pdrop/sa26/ctable.py` and the protoui `build_data2.py`. A rule key is
 * the unit a person stages a table against; every instance matching it follows.
 *
 * Pv basis (C x Pv): elbow and damper use their own (inlet) Pv; a transition the downstream
 * (outlet) Pv; a tap's branch leg Cb the branch Pv; its straight leg Cs the main's downstream Pv.
 */
import type { Section } from "./loss-physics.ts";

/** A connector's size as the rules read it. */
export interface Port {
  shape: string;
  section: Section | null;
}

/**
 * What a rule may know of a fitting. W1's `DuctNode` facts (`rOverD`, `aoOverA1`, `takeoff`) feed
 * `rOverD`/`aoOverA1`/`takeoff` through `fittingFacts` in losses.ts; sizes come from connectors.
 */
export interface FittingFacts {
  kind: "fitting" | "accessory";
  partType: string | null;
  rOverD: number | null;
  /** Outlet area over inlet area. */
  aoOverA1: number | null;
  inlet: Port;
  /** The port toward the terminal; null for a tap (its `inlet` is the branch) and a dead end. */
  outlet: Port | null;
  /** The main duct a tap hangs off. */
  main: Port | null;
  /** Branch area over main area at a tap. */
  abOverAc: number | null;
  takeoff: boolean;
}

/** Flow through the fitting, cfm. A tap also carries branch, main-upstream and main-downstream. */
export interface Flows {
  q: number;
  qb?: number;
  qc?: number;
  qs?: number;
}

export type Leg = "C" | "Cb" | "Cs";

export interface LossRule {
  key: string;
  family: string;
  type: string;
  cond: string;
  /** Upper-case ASHRAE table name. */
  table: string;
  options: readonly string[];
  basis: string;
  when(f: FittingFacts, flows: Flows): boolean;
  /** Table inputs for a leg under `table`: the result name and the x / y to look up. */
  input(
    f: FittingFacts,
    flows: Flows,
    table: string,
    leg: Leg,
  ): { res: string; x: number; y?: number };
  /** The section and flow whose velocity pressure the leg is charged on. */
  basisOf(f: FittingFacts, flows: Flows, leg: Leg): { section: Section | null; cfm: number };
}

const ELBOWS = ["CD3-2", "CD3-21", "CD3-9", "CD3-1", "CD3-11", "CD3-10"] as const;
const TAPS = ["SD5-9", "SD5-10", "SD5-11", "SD5-12", "SD5-13", "SD5-1", "SD5-2"] as const;
const TRANSITIONS = ["SR4-3", "SR4-1", "SR4-2", "SD4-2", "SD4-1"] as const;

const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-3;
const elbow = (f: FittingFacts) => f.partType === "Elbow" && f.inlet.shape === "round";
const dIn = (f: FittingFacts) => f.inlet.section?.dhIn ?? NaN;
const inletBasis = (f: FittingFacts, flows: Flows) => ({ section: f.inlet.section, cfm: flows.q });
const outletBasis = (f: FittingFacts, flows: Flows) => ({
  section: f.outlet?.section ?? null,
  cfm: flows.q,
});
const roundTo = (f: FittingFacts) => f.inlet.shape === "round" && f.outlet?.shape === "round";
const toRect = (f: FittingFacts) =>
  f.inlet.shape === "round" && f.outlet != null && f.outlet.shape !== "round";
const fromRect = (f: FittingFacts) => f.inlet.shape !== "round" && f.outlet?.shape === "round";
const transition = (f: FittingFacts) => f.partType === "Transition";
/** Elbow input: r/D for the r/D table, else the diameter. */
const elbowInput = (f: FittingFacts, _flows: Flows, table: string) =>
  table === "CD3-12" ? { res: "Co", x: f.rOverD ?? NaN } : { res: "Co", x: dIn(f) };
const angleInput = (f: FittingFacts) => ({ res: "Co", x: 45, y: f.aoOverA1 ?? NaN });

export const LOSS_RULES: readonly LossRule[] = [
  {
    key: "elbow-1d-le10",
    family: "Round Elbow",
    type: "1 D",
    cond: "D <= 10 in",
    table: "CD3-2",
    options: ELBOWS,
    basis: "Pv of the elbow",
    when: (f) => elbow(f) && near(f.rOverD, 1) && dIn(f) <= 10,
    input: elbowInput,
    basisOf: inletBasis,
  },
  {
    key: "elbow-1d-gt10",
    family: "Round Elbow",
    type: "1 D",
    cond: "D > 10 in",
    table: "CD3-21",
    options: ELBOWS,
    basis: "Pv of the elbow",
    when: (f) => elbow(f) && near(f.rOverD, 1) && dIn(f) > 10,
    input: elbowInput,
    basisOf: inletBasis,
  },
  {
    key: "elbow-075d",
    family: "Round Elbow",
    type: "0.75 D",
    cond: "",
    table: "CD3-12",
    options: ["CD3-12", ...ELBOWS],
    basis: "Pv of the elbow",
    when: (f) => elbow(f) && near(f.rOverD, 0.75),
    input: elbowInput,
    basisOf: inletBasis,
  },
  {
    key: "tap-std",
    family: "Round Takeoff",
    type: "Standard",
    cond: "design flow on the branch",
    table: "SD5-9",
    options: TAPS,
    basis: "branch leg: Pv of the branch; straight leg: Pv of the main downstream",
    when: (f, flows) => f.takeoff && (flows.qb ?? 0) > 0 && flows.qc! > 0,
    input: (f, flows, _t, leg) => {
      const qc = flows.qc!;
      if (leg === "Cs") return { res: "Cs", x: flows.qs! / qc, y: 1 };
      return {
        res: "Cb",
        x: flows.qb! / qc,
        y: f.abOverAc ?? (f.inlet.section?.areaFt2 ?? NaN) / (f.main?.section?.areaFt2 ?? NaN),
      };
    },
    basisOf: (f, flows, leg) =>
      leg === "Cs"
        ? { section: f.main?.section ?? null, cfm: flows.qs! }
        : { section: f.inlet.section, cfm: flows.qb! },
  },
  {
    key: "trx-grille",
    family: "Rectangular to Round Transition - Angle",
    type: "45 Degree",
    cond: "expansion into the grille boot (round to rectangular)",
    table: "SR4-3",
    options: TRANSITIONS,
    basis: "Pv downstream (rect outlet at the grille)",
    when: (f) => transition(f) && toRect(f),
    input: angleInput,
    basisOf: outletBasis,
  },
  {
    key: "trx-inlet",
    family: "Rectangular to Round Transition - Angle",
    type: "45 Degree",
    cond: "contraction at the unit outlet (rectangular to round)",
    table: "SD4-2",
    options: TRANSITIONS,
    basis: "Pv downstream (round outlet)",
    when: (f) => transition(f) && fromRect(f),
    input: angleInput,
    basisOf: outletBasis,
  },
  {
    key: "trx-round",
    family: "Round Transition - Angle",
    type: "45 Degree",
    cond: "",
    table: "SD4-1",
    options: TRANSITIONS,
    basis: "Pv downstream (outlet)",
    when: (f) => transition(f) && roundTo(f),
    input: angleInput,
    basisOf: outletBasis,
  },
  {
    key: "damper",
    family: "Mechanical Damper",
    type: "",
    cond: "fully open",
    table: "CD9-1",
    options: ["CD9-1"],
    basis: "Pv of the damper",
    when: (f) => f.kind === "accessory",
    input: () => ({ res: "Co", x: 0, y: 1 }),
    basisOf: inletBasis,
  },
];

export const ruleByKey = (key: string) => LOSS_RULES.find((r) => r.key === key);
