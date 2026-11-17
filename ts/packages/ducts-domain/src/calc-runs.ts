/**
 * What duct-systems reads off the fan calcs (MAP invariant 6): every calc's paths as runs of rows.
 * A shared duct is on each fan's calc at its total flow, so its loss is the same on each; nothing
 * here sums across fans or names an owner. A reader that wants one run for an element or a
 * terminal takes the first in calc order, which only selects which path lights up.
 */
import type { DuctsPriceRow, FanClaim } from "@pe/agent-contracts";
import type { Leg, Sheet } from "./sheet/types.ts";

/** A fan calc as it crosses the wire: the domain `Sheet` with the wire claim, never the mint's brand. */
export type Calc = Omit<Sheet, "claim"> & { claim: FanClaim };
/** One priced line of a run: a leg of a fan calc, in the row shape the panes draw. */
export type Row = DuctsPriceRow;
export type Provisional = { worst: "near-miss" | "stretched" | "anomalous"; count: number; findingIds: string[] } | null;

export interface CalcRun {
  /** `<unit>:<port>/<side>/p<index>`: the path's identity on its calc. */
  key: string;
  /** The fan whose calc this path is on. */
  unit: number;
  mark: string;
  side: "supply" | "return";
  end: Calc["paths"][number]["end"];
  /** The terminal the path ends at; null for any other end. */
  terminal: number | null;
  /** Element ids from the fan outward. */
  path: number[];
  rows: Row[];
  /** The path's whole loss; null while a leg is unpriced or a blocker stands on it. */
  total: number | null;
  /** The priced legs' sum: a subtotal when `total` is null. */
  knownInWg: number;
  tel: number;
  blockerIds: string[];
}

const rateOf = (dp: number | null, lengthFt: number) =>
  dp != null && lengthFt > 1e-9 && dp > 0 ? (dp / lengthFt) * 100 : undefined;

export function rowOf(leg: Leg, calc: Calc): Row {
  const e = leg.evidence;
  const fitting = calc.fittings.find((f) => f.elementId === leg.elementId);
  const blocker = calc.blockers.find((b) => b.elementId === leg.elementId);
  const rate = e.kind === "friction" ? rateOf(leg.lossInWg, e.lengthFt) : undefined;
  return {
    id: leg.elementId,
    kind: leg.kind === "duct" ? "friction" : leg.kind === "terminal" ? "terminal" : "fitting",
    dp: leg.lossInWg,
    desc: leg.lossSource.ref,
    eqFt: leg.equivalentFt,
    ...(leg.velocityFpm != null ? { fpm: leg.velocityFpm } : {}),
    ...(e.kind === "friction"
      ? { lengthFt: e.lengthFt, roughnessFt: e.roughnessFt, ...(rate != null ? { rate } : {}) }
      : {}),
    ...(e.kind === "coefficient"
      ? { rule: e.rule, table: e.table, c: e.coefficient, pv: e.velocityPressureInWg }
      : {}),
    // A fitting no rule matched keeps its family, so a person can assign one.
    ...(e.kind !== "coefficient" && fitting?.rule ? { rule: fitting.rule } : {}),
    ...(fitting?.family ? { family: fitting.family } : {}),
    ...(fitting && fitting.ruleSource === "none" && leg.lossInWg == null
      ? { finding: "no-rule" as const }
      : {}),
    ...(leg.lossInWg == null
      ? { error: fitting?.unpriced ?? blocker?.detail ?? "No priced leg on this fan's calc" }
      : {}),
  };
}

const runCache = new WeakMap<readonly Calc[], CalcRun[]>();

/** Every path of every calc, in calc order then the calc's own rank (worst first per side). */
export function runsOf(calcs: readonly Calc[]): CalcRun[] {
  const hit = runCache.get(calcs);
  if (hit) return hit;
  const runs = calcs.flatMap((calc) => {
    const rows = new Map(Object.values(calc.legs).map((leg) => [leg.id, rowOf(leg, calc)]));
    return calc.paths.map((path, index): CalcRun => {
      const own = path.legIds.map((id) => rows.get(id)!);
      const complete = !path.blockerIds.length && own.every((row) => row.dp != null);
      return {
        key: `${calc.fan.unitId}:${calc.fan.portIndex}/${path.side}/p${index}`,
        unit: calc.fan.unitId,
        mark: calc.fan.mark,
        side: path.side,
        end: path.end,
        terminal: path.end.kind === "terminal" ? path.end.elementId : null,
        // The fan first: a leg names the element it prices, and the walk starts at the unit.
        path: [...new Set([calc.fan.unitId, ...own.map((row) => row.id)])],
        rows: own,
        total: complete ? path.knownInWg : null,
        knownInWg: path.knownInWg,
        tel: own.reduce((sum, row) => sum + (row.eqFt ?? 0), 0),
        blockerIds: path.blockerIds,
      };
    });
  });
  runCache.set(calcs, runs);
  return runs;
}

/** The worst complete run ending at one of `terminals`, on `unit`'s calc when given; null when none is complete. */
export function worstRun(
  calcs: readonly Calc[],
  terminals: ReadonlySet<number>,
  unit?: number,
): (CalcRun & { total: number; terminal: number }) | null {
  let worst: CalcRun | null = null;
  for (const run of runsOf(calcs))
    if (
      run.total != null &&
      run.terminal != null &&
      terminals.has(run.terminal) &&
      (unit == null || run.unit === unit) &&
      run.total > (worst?.total ?? -Infinity)
    )
      worst = run;
  return worst as (CalcRun & { total: number; terminal: number }) | null;
}

/** The first run, in calc order, that ends at this terminal. */
export const runTo = (calcs: readonly Calc[], terminal: number) =>
  runsOf(calcs).find((run) => run.terminal === terminal) ?? null;

/** The calcs whose walk reaches any of these elements. */
export const calcsIn = (calcs: readonly Calc[], ids: ReadonlySet<number>) =>
  calcs.filter((calc) => ids.has(calc.fan.unitId) || calc.walkedElementIds.some((id) => ids.has(id)));
