/**
 * The fitting-loss rules, as data: type plus geometry condition -> ASHRAE table, the candidate
 * tables either author may edit instead, and how a fitting's facts become that table's inputs.
 * Ported from `.artifacts/pdrop/sa26/ctable.py` and the protoui `build_data2.py`. A rule key is
 * the unit either author assigns a table to; every instance matching it follows.
 *
 * Pv basis (C x Pv): elbow and damper use their own (inlet) Pv; a transition the downstream
 * (outlet) Pv; a tap's branch leg Cb the branch Pv; its straight leg Cs the main's downstream Pv.
 */
import { lookupGrid } from "./loss-grid.ts";
import type { Section } from "./loss-physics.ts";

/** A connector's size as the rules read it. */
export interface Port {
  shape: string;
  section: Section | null;
  widthIn?: number | null;
  heightIn?: number | null;
}

/**
 * What a rule may know of a fitting. W1's `DuctNode` facts (`rOverD`, `aoOverA1`, `takeoff`) feed
 * `rOverD`/`aoOverA1`/`takeoff` through `fittingFacts` in losses.ts; sizes come from connectors.
 */
export interface FittingFacts {
  kind: "fitting" | "accessory";
  family: string | null;
  partType: string | null;
  rOverD: number | null;
  centerRadiusIn?: number | null;
  junction?: { branch: Port; straight: Port; leg: "Cb" | "Cs" };
  /** Outlet area over inlet area. */
  aoOverA1: number | null;
  /** Measured included transition angle, degrees; never inferred from a type name. */
  angleDeg?: number | null;
  inputError?: string;
  /** An assumption the inputs rest on, carried onto the priced row. */
  note?: string;
  inlet: Port;
  /** Physical outlet for a transition; otherwise the port toward the terminal. Null for a tap/dead end. */
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
  ): { res: string; x: number; y?: number; factor?: number };
  /** The section and flow whose velocity pressure the leg is charged on. */
  basisOf(f: FittingFacts, flows: Flows, leg: Leg): { section: Section | null; cfm: number };
}

const ELBOWS = ["CD3-2", "CD3-21", "CD3-9", "CD3-1", "CD3-11", "CD3-10"] as const;
const TAPS = ["SD5-9", "SD5-10", "SD5-11", "SD5-12", "SD5-13", "SD5-1", "SD5-2"] as const;
const TRANSITIONS = ["SR4-3", "SR4-1", "SR4-2", "SD4-2", "SD4-1"] as const;
const VANED = [
  "CR3-14",
  "CR3-15",
  "CR3-16",
  "CR3-9",
  "CR3-10",
  "CR3-11",
  "CR3-12",
  "CR3-13",
] as const;

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
const rectTo = (f: FittingFacts) =>
  f.inlet.shape === "rectangular" && f.outlet?.shape === "rectangular";
const mitered = (f: FittingFacts) =>
  f.partType === "Elbow" && f.inlet.shape === "rectangular" && /mitered/i.test(f.family ?? "");
const vaned = (f: FittingFacts) => /vane/i.test(f.family ?? "");
const transition = (f: FittingFacts) => f.partType === "Transition";
/** Elbow input: r/D for the r/D table, else the diameter. */
const elbowInput = (f: FittingFacts, _flows: Flows, table: string) =>
  table === "CD3-12" ? { res: "Co", x: f.rOverD ?? NaN } : { res: "Co", x: dIn(f) };
const angleInput = (f: FittingFacts) => ({ res: "Co", x: f.angleDeg ?? NaN, y: f.aoOverA1 ?? NaN });

// CR3-1 angle factor K, verbatim from Revit's shipped CR3-1.tbl (Cp is the 90-degree grid).
const radiusAngleFactor = (angle: number) =>
  lookupGrid(
    {
      title: "CR3-1 Angle Factor K",
      xLabel: "Theta",
      x: [0, 20, 30, 45, 60, 75, 90, 110, 130, 150, 180],
      grid: [0, 0.31, 0.45, 0.6, 0.78, 0.9, 1, 1.13, 1.2, 1.28, 1.4],
    },
    angle,
  ).value;

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
  ...([90, 45] as const).map(
    (angle): LossRule => ({
      key: `elbow-15d-${angle}-le10`,
      family: "Round Elbow",
      type: "1.5 D die stamped",
      cond: `${angle} degrees, D <= 10 in`,
      table: angle === 90 ? "CD3-1" : "CD3-3",
      options: ["CD3-1", "CD3-3"],
      basis: "Pv of the elbow",
      when: (f) =>
        elbow(f) &&
        near(f.rOverD, 1.5) &&
        dIn(f) <= 10 &&
        f.angleDeg != null &&
        Math.abs(f.angleDeg - angle) < 0.01,
      input: elbowInput,
      basisOf: inletBasis,
    }),
  ),
  {
    key: "elbow-round-radius",
    family: "Round Elbow",
    type: "3 gore",
    cond: "r/D 1.5 to 2; 90 degrees",
    table: "CD3-12",
    options: ["CD3-12"],
    basis: "Pv of the elbow",
    when: (f) =>
      elbow(f) &&
      f.rOverD != null &&
      f.rOverD >= 1.5 &&
      f.rOverD <= 2 &&
      f.angleDeg != null &&
      Math.abs(f.angleDeg - 90) < 0.01,
    input: elbowInput,
    basisOf: inletBasis,
  },
  {
    key: "elbow-rect-radius",
    family: "Rectangular Elbow - Radius",
    type: "smooth radius without vanes",
    cond: "measured radius and angle",
    table: "CR3-1",
    options: ["CR3-1"],
    basis: "Pv of the elbow; Cp times angle factor K",
    when: (f) =>
      f.partType === "Elbow" &&
      f.inlet.shape === "rectangular" &&
      /radius/i.test(f.family ?? "") &&
      !vaned(f) &&
      (f.centerRadiusIn ?? 0) > 0 &&
      f.angleDeg != null &&
      f.angleDeg > 0 &&
      f.angleDeg <= 180,
    // ponytail: Width is the turn-plane side in these Revit radius families, as for the mitered rule.
    input: (f) => ({
      res: "Cp",
      x: (f.inlet.heightIn ?? NaN) / (f.inlet.widthIn ?? NaN),
      y: (f.centerRadiusIn ?? NaN) / (f.inlet.widthIn ?? NaN),
      factor: radiusAngleFactor(f.angleDeg!),
    }),
    basisOf: inletBasis,
  },
  {
    key: "tee-round",
    family: "Round Tee",
    type: "plain 90 degree",
    cond: "entered from the run",
    table: "SD5-9",
    options: ["SD5-9"],
    basis: "branch Pv on Cb; straight outlet Pv on Cs",
    when: (f, flows) =>
      f.partType === "Tee" && f.inlet.shape === "round" && !!f.junction && (flows.qc ?? 0) > 0,
    input: (f, flows) =>
      f.junction!.leg === "Cb"
        ? {
            res: "Cb",
            x: flows.qb! / flows.qc!,
            y: f.junction!.branch.section!.areaFt2 / f.inlet.section!.areaFt2,
          }
        : {
            res: "Cs",
            x: flows.qs! / flows.qc!,
            y: f.junction!.straight.section!.areaFt2 / f.inlet.section!.areaFt2,
          },
    basisOf: (f, flows) => ({ section: f.outlet?.section ?? null, cfm: flows.q }),
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
    type: "Measured angle",
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
    type: "Measured angle",
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
    type: "Measured angle",
    cond: "",
    table: "SD4-1",
    options: TRANSITIONS,
    basis: "Pv downstream (outlet)",
    when: (f) => transition(f) && roundTo(f),
    input: angleInput,
    basisOf: outletBasis,
  },
  {
    key: "elbow-mitered",
    family: "Rectangular Elbow - Mitered",
    type: "",
    cond: "no vanes",
    table: "CR3-6",
    options: ["CR3-6"],
    basis: "Pv of the elbow",
    when: (f) => mitered(f) && !vaned(f),
    // ponytail: H/W reads Revit's Width as the side in the plane of the turn (its rectangular elbow
    // families bend across Width); a connector frame would settle it per instance.
    input: (f) => ({
      res: "Co",
      x: (f.inlet.heightIn ?? NaN) / (f.inlet.widthIn ?? NaN),
      y: f.angleDeg ?? NaN,
    }),
    basisOf: inletBasis,
  },
  {
    key: "elbow-mitered-vaned",
    family: "Rectangular Elbow - Mitered - Double Thickness Vanes",
    type: "",
    cond: "turning vanes",
    table: "CR3-14",
    options: VANED,
    basis: "Pv of the elbow",
    when: (f) => mitered(f) && vaned(f),
    input: () => ({ res: "Co", x: 0 }),
    basisOf: inletBasis,
  },
  {
    key: "trx-rect",
    family: "Rectangular Transition - Angle",
    type: "Measured angle",
    cond: "rectangular to rectangular",
    table: "SR4-1",
    options: TRANSITIONS,
    basis: "Pv downstream (outlet)",
    when: (f) => transition(f) && rectTo(f),
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
    // Only a plain damper family is the fully open CD9-1 damper; a fire or smoke damper, a flex
    // connector or any other accessory has no rule and needs an authored value or assignment.
    when: (f) => f.kind === "accessory" && isPlainDamper(f.family),
    input: () => ({ res: "Co", x: 0, y: 1 }),
    basisOf: inletBasis,
  },
];

/** A damper family that is not a fire, smoke or combination damper (their construction differs from CD9-1). */
export const isPlainDamper = (family: string | null) =>
  family != null && /damper/i.test(family) && !/fire|smoke|combination/i.test(family);

export const ruleByKey = (key: string) => LOSS_RULES.find((r) => r.key === key);

/** A rule in the person's words: "Round Elbow 1 D · D ≤ 10 in" (family, type, condition). */
export const ruleWords = (rule: Pick<LossRule, "family" | "type" | "cond">) =>
  `${rule.family} ${rule.type} · ${rule.cond.replace("<=", "≤").replace(">=", "≥")}`;
