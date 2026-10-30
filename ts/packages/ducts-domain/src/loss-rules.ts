/**
 * The fitting-loss rules, as data: type plus geometry condition -> ASHRAE table, the candidate
 * tables either author may edit instead, and how a fitting's facts become that table's inputs.
 * Ported from `.artifacts/pdrop/sa26/ctable.py` and the protoui `build_data2.py`. A rule key is
 * the unit either author assigns a table to; every instance matching it follows.
 *
 * Pv basis (C x Pv): elbow and damper use their own (inlet) Pv; a transition the downstream
 * (outlet) Pv; a tap's branch leg Cb the branch Pv; its straight leg Cs the main's downstream Pv.
 * A junction where air converges (`converging`: the return side, or a branch feeding a main) takes
 * the converging tables (ED5 round, ER5 rectangular) with its real area ratios: ER5-1 and ED5-3
 * carry Ab/Ac and As/Ac axes, the bullhead tables ER5-5 and ED5-4 Ab1/Ac (and Ab2/Ac).
 *
 * Which velocity pressure a converging coefficient multiplies: neither Revit's .tbl text nor its
 * ASHRAE.xml states it (titles name the fitting and source only). The grids answer it: each Cb row
 * runs as 1/(Qb/Qc)^2 toward Qb/Qc 0.01 (ER5-1 As/Ac 0.5, Ab/Ac 0.5: -6313, -53.75, -9.06 at 0.01,
 * 0.1, 0.2 is Cb x (Qb/Qc)^2 = -0.63, -0.54, -0.36), which is a coefficient stated on the branch's
 * own velocity, and Cs rows the same in Qs/Qc on the straight's; ER5-5's Cb1 likewise on branch 1's.
 * That is ASHRAE's own-section convention for these tables, so Cb is charged on the branch Pv, Cs
 * on the straight (main away from the fan) Pv. Where a lookup clamps a ratio the coefficient is
 * the table's at its edge, so it is charged on the velocity the table's geometry implies there
 * (`atTableVelocity`), never a table coefficient on an off-table velocity: that pairing is what
 * blew up ER5-2 at Ab/Ac far from its 0.5 (Cb -1550 x the real branch Pv, -1.95 in-wg on a 4x4 tap).
 */
import { lookupGrid, type LookupPoint } from "./loss-grid.ts";
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
  /** Air joins at this junction (branch into main): converging tables, never the diverging ones. */
  converging?: boolean;
  /**
   * A tap entered from its branch whose main carries air both ways from it: on the return the two
   * main streams meet in the collar, a bullhead tee (Qb1 the larger stream, Qc the collar's).
   */
  bullhead?: boolean;
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
  /**
   * Table inputs for a leg under `table`: the result name and the x / y (/ z) to look up. A factor
   * scales the coefficient; as a function it reads the point the lookup used (clamps applied).
   */
  input(
    f: FittingFacts,
    flows: Flows,
    table: string,
    leg: Leg,
  ): {
    res: string;
    x: number;
    y?: number;
    z?: number;
    factor?: number | ((at: LookupPoint) => number);
    note?: string;
    /** Why this fitting lies outside the table, which is then never read (the leg is not priced). */
    refuse?: string;
  };
  /** The table priced when the default's grid is not served and no one assigned another. */
  fallback?: string;
  /** The section and flow whose velocity pressure the leg is charged on. */
  basisOf(f: FittingFacts, flows: Flows, leg: Leg): { section: Section | null; cfm: number };
}

const ELBOWS = ["CD3-2", "CD3-21", "CD3-9", "CD3-1", "CD3-11", "CD3-10"] as const;
const TAPS = ["SD5-9", "SD5-10", "SD5-11", "SD5-12", "SD5-13", "SD5-1", "SD5-2"] as const;
const CONVERGING_RECT = ["ER5-1", "ER5-2", "ER5-3"] as const;
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
const areaOf = (p: Port | null | undefined) => p?.section?.areaFt2 ?? NaN;
/** A takeoff's branch over its main: Revit's own ratio when it states one, else the two sections. */
const tapAbAc = (f: FittingFacts) => f.abOverAc ?? areaOf(f.inlet) / areaOf(f.main);
const ratio = (v: number) => +v.toFixed(3);
/**
 * A round junction whose branch or straight is larger than its common is outside ED5-3 (area
 * ratios up to 1) and outside what can be built: no collar is wider than the round main it taps.
 * ASHRAE tables do not extrapolate, and ED5-3's edge is no stand-in there (its Qb/Qc 0.01 and 1
 * columns run to +-2.6e5): FC-23's proposed tap at 13771256, a 20x20 collar on the 6 in duct
 * 13973156 (Ab/Ac 14.2), read Cb -262998 at the edge and, charged on the collar's 18 fpm, about
 * -5.3e7 (2026-10-29). Refused, the leg is not priced; a person types its drop or picks a table.
 * A small collar (below the axis) still reads at the edge, and ER5-1 keeps its clamp: a
 * rectangular collar on a main's long face can exceed the main's section (Chadds has 7 that do).
 */
const pastCommon = (table: string, abAc: number, asAc = 1) =>
  abAc > 1 + 1e-6 || asAc > 1 + 1e-6
    ? `Ab/Ac ${ratio(abAc)}, As/Ac ${ratio(asAc)}: a branch or straight larger than its round common is outside ${table}, which states area ratios up to 1`
    : undefined;

/**
 * The factor that charges a leg's coefficient on the velocity its table's geometry implies at the
 * point the lookup read. A leg's velocity pressure is the common's times (Q/Qc / A/Ac)^2, so with
 * `q` / `a` the junction's flow and area ratios and `pick` the table's at the lookup point, the
 * table's Pv over the junction's is ((q' / a') / (q / a))^2: exactly 1 when nothing clamped, and
 * an axis the grid does not have (a constant stub) reads as the junction's own.
 */
const atTableVelocity =
  (q: number, a: number, pick: (at: LookupPoint) => readonly [number?, number?]) =>
  (at: LookupPoint) => {
    const [qt = q, ta = a] = pick(at);
    return qt === q && ta === a ? 1 : (qt / ta / (q / a)) ** 2;
  };

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
      f.partType === "Tee" &&
      f.inlet.shape === "round" &&
      !!f.junction &&
      !f.converging &&
      (flows.qc ?? 0) > 0,
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
    // A round supply bullhead (collar air dividing both ways) is SD5-18's (bullhead-diverging-round),
    // never a tap; a rectangular one stays here, as SD5-18 is round-only and nothing better exists.
    when: (f, flows) =>
      f.takeoff &&
      !f.converging &&
      !(f.bullhead && f.main?.shape === "round") &&
      (flows.qb ?? 0) > 0 &&
      flows.qc! > 0,
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
    key: "bullhead-diverging-round",
    family: "Round Takeoff",
    type: "bullhead, diverging",
    cond: "entered from its branch on the supply; the collar's air divides both ways along a round main",
    table: "SD5-18",
    options: ["SD5-18", "SD5-19"],
    basis: "Pv of this path's main side at its own flow (branch 1)",
    // fix6 defect 4 (MUAS-1 takeoff 14806947, 115 cfm dividing 50 / 65): SD5-18 (Sepsy 1969,
    // bullhead tee without vanes, diverging) states Cb1 by Qb1/Qc and Ab1/Ac, the stem c being the
    // collar. Each path is its own branch 1 (the sheet prices one leg per main side); a straight
    // main is the same size both ways, so Ab1/Ac is the main over the collar.
    // Basis verified 2026-10-30 against Revit's shipped Sd5-18.tbl: Cb1 is 1.02 on the diagonal
    // (Qb1/Qc = Ab1/Ac, so Vb1 = Vc) and grows as (Vc/Vb1)^2 off it (Ab1/Ac 1, Qb1/Qc 0.01: 10028),
    // i.e. a loss near 1.02 Pv_c written on branch 1's Pv: Cb1 multiplies Pv of branch 1.
    when: (f, flows) =>
      !!f.bullhead &&
      !f.converging &&
      f.main?.shape === "round" &&
      (flows.qb ?? 0) > 0 &&
      (flows.qc ?? 0) > 0,
    input: (f, flows) => {
      const x = flows.qb! / flows.qc!;
      const a = areaOf(f.main) / areaOf(f.inlet);
      return {
        res: "Cb1",
        x,
        y: a,
        factor: atTableVelocity(x, a, (at) => [at.x, at.y]),
        note: `bullhead, diverging: this path is branch 1; Ab1/Ac ${ratio(a)}`,
      };
    },
    basisOf: (f, flows) => ({ section: f.main?.section ?? null, cfm: flows.qb! }),
  },
  {
    key: "bullhead-converging-rect",
    family: "Takeoff",
    type: "bullhead, converging",
    cond: "entered from its branch; the rectangular main brings air from both sides",
    table: "ER5-5",
    options: ["ER5-5"],
    basis: "Pv of the larger main stream (branch 1)",
    when: (f, flows) =>
      !!f.bullhead &&
      !!f.converging &&
      f.main?.shape === "rectangular" &&
      (flows.qb ?? 0) > 0 &&
      (flows.qc ?? 0) > 0,
    // ER5-5 (Idelchik 1986, 7-23, bullhead tee without vanes): Cb1 by Qb1/Qc and Ab1/Ac, the stem c
    // being the collar. Branch 1 is the larger main stream; a collar on a straight main sees the main
    // on both sides, so Ab1/Ac is the main over the collar, often past the table's Ab1/Ac 1.
    input: (f, flows) => {
      const x = flows.qb! / flows.qc!;
      const a = areaOf(f.main) / areaOf(f.inlet);
      return {
        res: "Cb1",
        x,
        y: a,
        factor: atTableVelocity(x, a, (at) => [at.x, at.y]),
        note: `bullhead: branch 1 is the larger of the two main streams; Ab1/Ac ${ratio(a)}`,
      };
    },
    basisOf: (f, flows) => ({ section: f.main?.section ?? null, cfm: flows.qb! }),
  },
  {
    key: "bullhead-converging-round",
    family: "Round Takeoff",
    type: "bullhead, converging",
    cond: "entered from its branch; the round main brings air from both sides",
    table: "ED5-4",
    options: ["ED5-4"],
    basis: "Pv of the larger main stream (branch 1)",
    when: (f, flows) =>
      !!f.bullhead &&
      !!f.converging &&
      f.main?.shape === "round" &&
      (flows.qb ?? 0) > 0 &&
      (flows.qc ?? 0) > 0,
    // ED5-4 (UMC 1985, bullhead tee without vanes, Db1 >= Db2): Cb1 by Qb1/Qc, Ab2/Ac and Ab1/Ac.
    // A straight main is the same size both sides, so Ab1 = Ab2 = the main.
    input: (f, flows) => {
      const x = flows.qb! / flows.qc!;
      const a = areaOf(f.main) / areaOf(f.inlet);
      return {
        res: "Cb1",
        x,
        y: a,
        z: a,
        factor: atTableVelocity(x, a, (at) => [at.x, at.z]),
        note: `bullhead: branch 1 is the larger of the two main streams; Ab1/Ac = Ab2/Ac ${ratio(a)}`,
      };
    },
    basisOf: (f, flows) => ({ section: f.main?.section ?? null, cfm: flows.qb! }),
  },
  {
    key: "tap-converging-rect",
    family: "Takeoff",
    type: "converging",
    cond: "air joins a rectangular main",
    table: "ER5-1",
    options: CONVERGING_RECT,
    fallback: "ER5-2",
    basis: "branch leg: Pv of the branch; straight leg: Pv of the main away from the fan",
    when: (f, flows) =>
      f.takeoff &&
      !!f.converging &&
      !f.bullhead &&
      f.main?.shape === "rectangular" &&
      (flows.qb ?? 0) > 0 &&
      (flows.qc ?? 0) > 0,
    // ER5-1 is Revit's one rectangular converging junction with area axes (Ab/Ac by As/Ac), and it
    // is a smooth-radius wye (Idelchik 1986, 7-11; branch 90 degrees): a straight-collar takeoff is
    // read on it as the nearest stated geometry, and the row says so. A takeoff on a constant main
    // has As = Ac. ER5-2 (round tap) and ER5-3 (45 degree entry) state one axis, at Ab/Ac 0.5 and
    // As = Ac (Revit's ASHRAE.xml): read at that geometry, the row names this junction's Ab/Ac.
    input: (f, flows, table, leg) => {
      const abAc = tapAbAc(f);
      const x = (leg === "Cs" ? flows.qs! : flows.qb!) / flows.qc!;
      if (table === "ER5-1") {
        const note = "ER5-1 is a smooth-radius wye; this takeoff is read on it with As = Ac";
        return leg === "Cs"
          ? {
              res: "Cs",
              x,
              y: abAc,
              z: 1,
              factor: atTableVelocity(x, 1, (at) => [at.x, at.z]),
              note,
            }
          : {
              res: "Cb",
              x,
              y: abAc,
              z: 1,
              factor: atTableVelocity(x, abAc, (at) => [at.x, at.y]),
              note,
            };
      }
      const branch =
        table === "ER5-2" && f.inlet.shape !== "round"
          ? "; round-tap table on a rectangular branch"
          : "";
      const note = `${table} is stated for Ab/Ac 0.5, As = Ac; this junction's Ab/Ac is ${ratio(abAc)}${branch}`;
      return leg === "Cs"
        ? { res: "Cs", x, factor: atTableVelocity(x, 1, (at) => [at.x, 1]), note }
        : { res: "Cb", x, factor: atTableVelocity(x, abAc, (at) => [at.x, 0.5]), note };
    },
    basisOf: (f, flows, leg) =>
      leg === "Cs"
        ? { section: f.main?.section ?? null, cfm: flows.qs! }
        : { section: f.inlet.section, cfm: flows.qb! },
  },
  {
    key: "junction-converging-round",
    family: "Round Tee or Takeoff",
    type: "converging",
    cond: "air joins a round main",
    table: "ED5-3",
    options: ["ED5-3"],
    basis: "branch leg: Pv of the branch; straight leg: Pv of the main away from the fan",
    when: (f, flows) =>
      !!f.converging &&
      !f.bullhead &&
      (flows.qb ?? 0) > 0 &&
      (flows.qc ?? 0) > 0 &&
      ((f.takeoff && f.main?.shape === "round") ||
        (f.partType === "Tee" && f.inlet.shape === "round" && !!f.junction)),
    // ED5-3 (Sepsy 1973, 90 degree round tee): As/Ac by Ab/Ac by Qb/Qc. Dc picks the block: "Cb"/"Cs"
    // for Dc <= 10 in, "#2" above. A takeoff's common is its main (As = Ac); a tee's is its run port
    // toward the fan, and the leg is the port the path leaves by (a tee is priced as leg "C").
    input: (f, flows, _t, leg) => {
      const common = f.takeoff ? f.main : f.inlet;
      const block = (common?.section?.dhIn ?? NaN) > 10 ? "#2" : "";
      const abAc = f.takeoff ? tapAbAc(f) : areaOf(f.junction?.branch) / areaOf(common);
      const asAc = f.takeoff ? 1 : areaOf(f.junction?.straight) / areaOf(common);
      const refuse = pastCommon("ED5-3", abAc, asAc);
      if (refuse) return { res: `${(f.junction?.leg ?? leg) === "Cs" ? "Cs" : "Cb"}${block}`, x: NaN, refuse };
      if ((f.junction?.leg ?? leg) === "Cs") {
        const x = flows.qs! / flows.qc!;
        return {
          res: `Cs${block}`,
          x,
          y: abAc,
          z: asAc,
          factor: atTableVelocity(x, asAc, (at) => [at.x, at.z]),
        };
      }
      const x = flows.qb! / flows.qc!;
      return {
        res: `Cb${block}`,
        x,
        y: abAc,
        z: asAc,
        factor: atTableVelocity(x, abAc, (at) => [at.x, at.y]),
      };
    },
    basisOf: (f, flows, leg) =>
      (f.junction?.leg ?? leg) === "Cs"
        ? { section: (f.takeoff ? f.main : f.junction?.straight)?.section ?? null, cfm: flows.qs! }
        : { section: (f.takeoff ? f.inlet : f.junction?.branch)?.section ?? null, cfm: flows.qb! },
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
    when: (f) =>
      f.kind === "accessory" && isPlainDamper(f.family) && f.inlet.shape !== "rectangular",
    input: () => ({ res: "Co", x: 0, y: 1 }),
    basisOf: inletBasis,
  },
  {
    key: "damper-rect",
    family: "Mechanical Damper",
    type: "rectangular",
    cond: "fully open",
    table: "CR9-1",
    options: ["CR9-1"],
    basis: "Pv of the damper",
    when: (f) =>
      f.kind === "accessory" && isPlainDamper(f.family) && f.inlet.shape === "rectangular",
    // CR9-1 is Theta by H/W; fully open is Theta 0.
    input: (f) => ({ res: "Co", x: 0, y: (f.inlet.heightIn ?? NaN) / (f.inlet.widthIn ?? NaN) }),
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
