/** Lifted from `losses.ts` (ruleRow, ductRows, terminalRow, the implausible guard) and `equivalent-length.ts`; network-free: prices one leg from explicit facts and flows. */
import { GridError, lookupGrid, type Grids } from "../loss-grid.ts";
import { friction, sectionOf } from "../loss-physics.ts";
import { LOSS_RULES, ruleByKey, type FittingFacts, type Leg } from "../loss-rules.ts";
import { ruleFlows, type LegFlows, type Node, type Segment } from "./fitting-facts.ts";

/** First guesses to recalibrate (kaitpw 2026-10-22); one fitting dropping more than this fell off its table. */
export const IMPLAUSIBLE_ROW_IN_WG = 0.5;
/** Residential sanity bound on a fitting's velocity, fpm. */
export const IMPLAUSIBLE_FPM = 4000;

// firm-default: 0.08 in-wg per 100 ft is a typical residential design friction rate (equivalent-length.ts).
export const DEFAULT_DESIGN_FRICTION_RATE = 0.08;

export type LegInput =
  | { kind: "duct"; segment: Segment; lengthFt: number; cfm: number }
  | {
      kind: "fitting";
      fitting: Node;
      facts: FittingFacts;
      flows: LegFlows;
      leg: Leg;
      /** A person's rule assignment for the family, read before any rule's own `when`. */
      ruleKey?: string | null;
      /** A typed drop, in-wg, replacing the rule lookup (not for a tap). */
      statedInWg?: number | null;
    }
  | {
      kind: "drop";
      element: Node;
      cfm: number | null;
      inWg: number | null;
      /** Where the drop came from: typed, parameter, firm default (with version), catalog. */
      source: string;
    };

/** Why a fitting leg is not trusted: the lookup, the velocity and the flow behind it. */
export interface ImplausibleLoss {
  coefficient: number;
  res: "Co" | "Cb" | "Cs";
  fpm: number;
  cfm: number;
  reasons: ("drop" | "velocity")[];
}

export type LegSource =
  | { kind: "friction"; f: number; roughnessFt: number; rateInWgPer100Ft: number | null }
  | {
      kind: "rule";
      rule: string;
      table: string;
      coefficient: number;
      pv: number;
      inputs: { res: string; x: number; y?: number; xLabel: string; yLabel?: string };
      notes: string[];
    }
  | { kind: "drop"; source: string };

export interface PricedLeg {
  kind: LegInput["kind"];
  elementId: number;
  lossInWg: number | null;
  velocityFpm: number | null;
  source: LegSource | null;
  /** Why the leg has no price; null when priced. */
  unpriced: string | null;
  implausible?: ImplausibleLoss;
  /** Friction legs: the straight length priced, ft. */
  lengthFt?: number;
}

/** Table name per rule key, upper case; absent keys use the rule default. */
export type Choices = Readonly<Record<string, string>>;

const round4 = (n: number) => +n.toFixed(4);

const unpriced = (input: LegInput, reason: string, extra: Partial<PricedLeg> = {}): PricedLeg => ({
  kind: input.kind,
  elementId:
    input.kind === "duct"
      ? input.segment.id
      : input.kind === "fitting"
        ? input.fitting.id
        : input.element.id,
  lossInWg: null,
  velocityFpm: null,
  source: null,
  unpriced: reason,
  ...extra,
});

/** Price one leg. Duct friction (Altshul-Tsal with the duct's roughness), fitting via rule + grid, or a typed drop. */
export function priceLeg(input: LegInput, grids: Grids, choices: Choices = {}): PricedLeg {
  if (input.kind === "duct") {
    const s = input.segment;
    const section = sectionOf(s.shape, s.diameterIn, s.widthIn, s.heightIn);
    if (!section) return unpriced(input, `${s.kind} (${s.size}) has no section Pe can use`);
    const f = friction(section, input.cfm, input.lengthFt, s.roughness.valueFt);
    const rate = input.lengthFt > 1e-9 && f.dp > 0 ? (f.dp / input.lengthFt) * 100 : null;
    return {
      kind: "duct",
      elementId: s.id,
      lossInWg: f.dp,
      velocityFpm: f.fpm,
      source: {
        kind: "friction",
        f: f.f,
        roughnessFt: s.roughness.valueFt,
        rateInWgPer100Ft: rate,
      },
      unpriced: null,
      lengthFt: input.lengthFt,
    };
  }
  if (input.kind === "drop") {
    if (input.inWg == null)
      return unpriced(
        input,
        `${input.element.kind} ${input.element.id} has no drop (${input.source})`,
      );
    return {
      kind: "drop",
      elementId: input.element.id,
      lossInWg: input.inWg,
      velocityFpm: null,
      source: { kind: "drop", source: input.source },
      unpriced: null,
    };
  }
  const { fitting: node, facts, leg } = input;
  const flows = ruleFlows(input.flows);
  if (input.statedInWg != null && !facts.takeoff)
    return {
      kind: "fitting",
      elementId: node.id,
      lossInWg: input.statedInWg,
      velocityFpm: null,
      source: { kind: "drop", source: "typed" },
      unpriced: null,
    };
  if (facts.inputError) return unpriced(input, facts.inputError);
  const assigned = input.ruleKey ? ruleByKey(input.ruleKey) : undefined;
  const rule = assigned ?? LOSS_RULES.find((r) => r.when(facts, flows));
  if (!rule)
    return unpriced(
      input,
      facts.takeoff
        ? `tap ${node.id} carries no branch flow or its main flow is unknown, no takeoff rule applies`
        : `no rule matches ${node.kind}${node.partType ? ` ${node.partType}` : ""}${facts.family ? ` (${facts.family})` : ""}`,
    );
  const table = (choices[rule.key] ?? rule.table).toUpperCase();
  const lookup = rule.input(facts, flows, table, leg);
  const grid = grids[table]?.[lookup.res];
  if (!grid) return unpriced(input, `${table} ${lookup.res} is not loaded`);
  let found;
  try {
    found = lookupGrid(grid, lookup.x, lookup.y);
    found.value *= lookup.factor ?? 1;
  } catch (e) {
    if (e instanceof GridError) return unpriced(input, e.message);
    throw e;
  }
  const basis = rule.basisOf(facts, flows, leg);
  if (!basis.section) return unpriced(input, "no cross-section for the velocity pressure");
  const f = friction(basis.section, basis.cfm, 0);
  const reasons: ImplausibleLoss["reasons"] = [];
  if (found.value * f.pv > IMPLAUSIBLE_ROW_IN_WG) reasons.push("drop");
  if (f.fpm > IMPLAUSIBLE_FPM) reasons.push("velocity");
  const source: LegSource = {
    kind: "rule",
    rule: rule.key,
    table,
    coefficient: found.value,
    pv: f.pv,
    inputs: {
      res: lookup.res,
      x: lookup.x,
      ...(lookup.y == null ? {} : { y: lookup.y }),
      xLabel: grid.xLabel,
      ...(grid.yLabel ? { yLabel: grid.yLabel } : {}),
    },
    notes: [...found.notes, ...(facts.note ? [facts.note] : [])],
  };
  if (reasons.length) {
    const why = reasons.map((r) =>
      r === "drop"
        ? `${round4(found.value * f.pv)} in-wg over ${IMPLAUSIBLE_ROW_IN_WG}`
        : `velocity over ${IMPLAUSIBLE_FPM} fpm`,
    );
    return unpriced(
      input,
      `implausible loss at ${rule.family} ${node.id}, rule ${rule.key}, table ${table}: ${lookup.res} ${round4(found.value)}, ${Math.round(f.fpm)} fpm, ${Math.round(basis.cfm)} cfm (${why.join(", ")})`,
      {
        velocityFpm: f.fpm,
        source,
        implausible: {
          coefficient: found.value,
          res: lookup.res as ImplausibleLoss["res"],
          fpm: f.fpm,
          cfm: basis.cfm,
          reasons,
        },
      },
    );
  }
  return {
    kind: "fitting",
    elementId: node.id,
    lossInWg: found.value * f.pv,
    velocityFpm: f.fpm,
    source,
    unpriced: null,
  };
}

/**
 * Equivalent feet per leg (`equivalent-length.ts` semantics, the RHVAC convention): a duct leg is
 * its own length; a rule-priced fitting leg is `dp / rate x 100` at the rate of the nearest duct
 * leg before it on the path, else after it, else `designRate`. A typed drop stays in in-wg
 * (null); so does an unpriced leg.
 */
export function equivalentFeet(
  legs: readonly PricedLeg[],
  designRate = DEFAULT_DESIGN_FRICTION_RATE,
): (number | null)[] {
  const rates = legs.map((l) => (l.source?.kind === "friction" ? l.source.rateInWgPer100Ft : null));
  const refRate = (i: number) => {
    for (let k = i - 1; k >= 0; k--) if (rates[k] != null) return rates[k]!;
    for (let k = i + 1; k < legs.length; k++) if (rates[k] != null) return rates[k]!;
    return designRate;
  };
  return legs.map((l, i) => {
    if (l.lossInWg == null) return null;
    if (l.kind === "duct") return l.lengthFt ?? 0;
    if (l.source?.kind !== "rule") return null;
    return (l.lossInWg / refRate(i)) * 100;
  });
}
