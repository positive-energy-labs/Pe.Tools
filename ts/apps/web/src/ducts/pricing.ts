/**
 * The losses view's model, pure: what Revit holds now (the applied tables), what the person
 * staged on top, the two solves, and the `ducts.apply` request built from the staged cells.
 * The solver is W2's (`losses.ts`); nothing here looks a coefficient up itself.
 */
import { stagedDucts, type DuctsApplyInput, type DuctsRouteDocument } from "@pe/agent-contracts";

import type { Grids } from "./loss-grid";
import { LOSS_RULES, ruleByKey } from "./loss-rules";
import {
  computeLosses,
  fanout,
  systemFor,
  type Choices,
  type Fanout,
  type LossResult,
  type Overrides,
  type Row,
} from "./losses";
import type { DuctSnapshot } from "./readiness";

type Node = DuctSnapshot["nodes"][number];

/** Every table a rule may be looked up under: the one `ducts.tables` read. */
export const TABLE_IDS: readonly string[] = [
  ...new Set(LOSS_RULES.flatMap((rule) => rule.options)),
].sort();

/** The tables Pe's provenance store says were last applied, per rule key; absent = the default. */
export const appliedChoices = (snapshot: DuctSnapshot): Choices =>
  Object.fromEntries(
    Object.entries(snapshot.store?.rules ?? {}).flatMap(([key, rule]) =>
      rule.table ? [[key, rule.table.toUpperCase()]] : [],
    ),
  );

const byId = <V>(cells: Record<string, V>, pick: (value: V) => number) =>
  Object.fromEntries(Object.entries(cells).map(([id, value]) => [Number(id), pick(value)]));

export interface Priced {
  applied: Choices;
  /** Applied plus staged: what apply would leave in Revit. */
  choices: Choices;
  overrides: Overrides;
  /** The solve as Revit holds it now. */
  now: LossResult;
  /** The solve with every staged cell landed. */
  next: LossResult;
  staged: ReturnType<typeof stagedDucts>;
}

/**
 * What depends on (snapshot, grids) alone, kept so a Work change re-solves only `next`: the
 * applied solve, the last priced Work, and each staged rule's fanout.
 */
interface Solved {
  applied: Choices;
  now: LossResult;
  last: { doc: DuctsRouteDocument | null; priced: Priced } | null;
  fanouts: Map<string, Fanout>;
}

const solved = new WeakMap<DuctSnapshot, WeakMap<Grids, Solved>>();

function solvedFor(snapshot: DuctSnapshot, grids: Grids): Solved {
  const byGrids = solved.get(snapshot) ?? solved.set(snapshot, new WeakMap()).get(snapshot)!;
  let entry = byGrids.get(grids);
  if (!entry) {
    const applied = appliedChoices(snapshot);
    entry = {
      applied,
      now: computeLosses(snapshot, grids, applied),
      last: null,
      fanouts: new Map(),
    };
    byGrids.set(grids, entry);
  }
  return entry;
}

/** Cached per (snapshot, grids) and, for the last one, per `doc`: callers may price freely. */
export function price(
  snapshot: DuctSnapshot,
  grids: Grids,
  doc: DuctsRouteDocument | null,
): Priced {
  const entry = solvedFor(snapshot, grids);
  if (entry.last?.doc === doc) return entry.last.priced;
  const staged = stagedDucts(doc);
  const { applied, now } = entry;
  const choices = {
    ...applied,
    ...Object.fromEntries(Object.entries(staged.rules).map(([key, { table }]) => [key, table])),
  };
  const overrides: Overrides = {
    terminalPs: byId(staged.terminalDrops, (drop) => drop.inWg),
    componentDrop: byId(staged.componentDrops, (drop) => drop.inWg),
  };
  const same = Object.keys(staged.rules).length === 0 && !hasDrops(staged);
  const priced: Priced = {
    applied,
    choices,
    overrides,
    now,
    next: same ? now : computeLosses(snapshot, grids, choices, overrides),
    staged,
  };
  entry.last = { doc, priced };
  return priced;
}
const hasDrops = (staged: Priced["staged"]) =>
  Object.keys(staged.terminalDrops).length + Object.keys(staged.componentDrops).length > 0;

/** The table a rule is looked up under: staged, else applied, else its default. */
export const tableOf = (priced: Pick<Priced, "choices">, key: string) =>
  (priced.choices[key] ?? ruleByKey(key)?.table ?? "").toUpperCase();

/** What staging one rule's table moves, against the applied state (W2's `fanout`). */
export function stagedFanout(
  snapshot: DuctSnapshot,
  grids: Grids,
  priced: Priced,
  key: string,
): Fanout | null {
  const table = priced.staged.rules[key]?.table;
  const rule = ruleByKey(key);
  if (!table || !rule?.options.includes(table.toUpperCase())) return null;
  // Depends on the applied state and the one rule, never on the rest of the Work.
  const { fanouts } = solvedFor(snapshot, grids);
  const at = `${key}|${table.toUpperCase()}`;
  let f = fanouts.get(at);
  if (!f)
    fanouts.set(at, (f = fanout(snapshot, grids, priced.applied, key, table, {}, priced.now)));
  return f;
}

/** The part a row charges in a terminal's bar. */
export const PARTS = ["friction", "elbow", "tap", "transition", "damper", "terminal"] as const;
export type Part = (typeof PARTS)[number];

export function partOf(row: Row, node: Node | undefined): Part {
  if (row.kind === "friction") return "friction";
  if (row.kind === "terminal") return "terminal";
  if (row.kind === "tap-branch" || row.kind === "tap-straight") return "tap";
  const key = row.rule ?? "";
  if (key.startsWith("elbow") || node?.partType === "Elbow") return "elbow";
  if (key.startsWith("trx") || node?.partType === "Transition") return "transition";
  return "damper";
}

/**
 * The one priced row per fitting a rule covers, over every path: a tap's branch leg, since Revit
 * holds one coefficient per tap and charges it on the branch flow.
 */
export function instancesOf(result: LossResult, key: string): Map<number, Row> {
  const out = new Map<number, Row>();
  for (const path of Object.values(result.paths))
    for (const row of path.rows)
      if (row.rule === key && (row.kind !== "tap-straight" || !out.has(row.id)))
        out.set(row.id, row);
  return out;
}

/** A row's table lookup as the store keeps it: "xLabel=x, yLabel=y". */
const inputsOf = ({ inputs }: Row) => {
  if (!inputs) return "";
  const at = (n: number) => +n.toPrecision(4);
  const x = `${inputs.xLabel}=${at(inputs.x)}`;
  return inputs.y == null ? x : `${x}, ${inputs.yLabel ?? "y"}=${at(inputs.y)}`;
};

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Each group's fan static by its air mover, from Pe's solve: parallel groups of one
 * classification share the largest, and a unit's supply and return add (they are in series).
 */
export function fanWrites(
  snapshot: DuctSnapshot,
  result: LossResult,
  groups: ReadonlySet<string>,
): DuctsApplyInput["equipment"] {
  const byUnit = new Map<number, Map<string, number>>();
  for (const group of snapshot.groups) {
    const solved = result.byGroup[group.id];
    if (!groups.has(group.id) || !solved || solved.critical == null) continue;
    const unit =
      group.rootIds.length === 1
        ? group.rootIds[0]!
        : systemFor(snapshot, solved.critical)?.baseEquipmentId;
    if (unit == null) continue;
    const kind = group.classifications.join(",");
    const fans = byUnit.get(unit) ?? byUnit.set(unit, new Map()).get(unit)!;
    fans.set(kind, Math.max(fans.get(kind) ?? 0, solved.fan));
  }
  return [...byUnit]
    .map(([id, fans]) => ({
      id,
      externalStaticInWg: round4([...fans.values()].reduce((a, b) => a + b, 0)),
    }))
    .sort((a, b) => a.id - b.id);
}

/**
 * The native `ducts.apply` request (less `previewOnly`) from the staged cells only: every instance of a staged rule under
 * its chosen table (instances the table cannot price are left out, and the band says so), every
 * staged drop, the staged parameter slots, and the fan static of each group a write touches.
 */
export function applyRequest(
  snapshot: DuctSnapshot,
  priced: Priced,
  appliedAt: string,
): DuctsApplyInput {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const fittings = Object.keys(priced.staged.rules)
    .sort()
    .flatMap((ruleKey) =>
      [...instancesOf(priced.next, ruleKey).values()]
        .filter((row) => row.c != null && !row.error)
        .map((row) => ({
          id: row.id,
          coefficient: row.c!,
          table: row.table!,
          inputs: inputsOf(row),
          ruleKey,
        })),
    )
    .sort((a, b) => a.id - b.id);
  const drops = (cells: Priced["staged"]["terminalDrops"]) =>
    Object.entries(cells)
      .map(([id, drop]) => ({ id: Number(id), inWg: drop.inWg, source: drop.source ?? null }))
      .sort((a, b) => a.id - b.id);
  const terminals = drops(priced.staged.terminalDrops);
  const components = drops(priced.staged.componentDrops);
  const touched = new Set(
    [...fittings, ...terminals, ...components].flatMap(({ id }) => nodes.get(id)?.groupId ?? []),
  );
  const slots = priced.staged.parameters;
  const stored = snapshot.store;
  return {
    slots,
    fittings,
    terminals,
    components,
    equipment: fanWrites(snapshot, priced.next, touched),
    // Revit's own critical path (the check beside Pe's) needs the network-based engine.
    networkBasedCalculations: true,
    // The native op writes the store as sent: the model's store (unknown keys included) with
    // this apply over it, at the revision read, so a store that moved since refuses as stale.
    store: {
      ...stored,
      version: 1,
      rules: Object.fromEntries(
        Object.entries(priced.choices).map(([key, table]) => [key, { table: table.toUpperCase() }]),
      ),
      instances: {
        ...stored?.instances,
        ...Object.fromEntries(
          fittings.map(({ id, table, inputs, coefficient }) => [
            String(id),
            { table, inputs, coefficient, appliedAt },
          ]),
        ),
      },
      terminals: {
        ...stored?.terminals,
        ...Object.fromEntries(
          terminals.map(({ id, inWg, source }) => [String(id), { inWg, source, appliedAt }]),
        ),
      },
      slots: Object.fromEntries(
        Object.entries({ ...snapshot.slots, ...slots }).filter(([, name]) => !!name),
      ),
      workRevision: stored?.workRevision ?? 0,
      appliedAt,
    },
  };
}

/** Rule instances a staged table cannot price: left out of the write, named in the band. */
export const unpriced = (priced: Priced, key: string) =>
  [...instancesOf(priced.next, key).values()].filter((row) => row.c == null || row.error).length;
