/**
 * The losses view's model, pure: what Revit holds now (the applied tables), what the person
 * staged on top, the two solves, and the `ducts.apply` request built from the staged cells.
 * The solver is W2's (`losses.ts`); nothing here looks a coefficient up itself.
 */
import { stagedDucts, type DuctsApplyInput, type DuctsRouteDocument } from "@pe/agent-contracts";

import { stagedLink, EMPTY_CATALOGS, type Catalogs } from "./catalog.ts";
import type { Grids } from "./loss-grid.ts";
import { LOSS_RULES, ruleByKey } from "./loss-rules.ts";
import {
  computeLosses,
  fanout,
  systemFor,
  type Choices,
  type Fanout,
  type LossResult,
  type Overrides,
  type Row,
} from "./losses.ts";
import { survey, type Survey } from "./survey.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Group = DuctSnapshot["groups"][number];

/** Every table a rule may be looked up under: the one `ducts.tables` read. */
export const TABLE_IDS: readonly string[] = [
  ...new Set(LOSS_RULES.flatMap((rule) => rule.options)),
].sort();

/** The tables Pe's provenance store says were last applied, per rule key; absent = the default. */
const appliedChoices = (snapshot: DuctSnapshot): Choices =>
  Object.fromEntries(
    Object.entries(snapshot.store?.rules ?? {}).flatMap(([key, rule]) =>
      rule.table ? [[key, rule.table.toUpperCase()]] : [],
    ),
  );

const byId = <V>(cells: Record<string, V>, pick: (value: V) => number) =>
  Object.fromEntries(Object.entries(cells).map(([id, value]) => [Number(id), pick(value)]));

/** The solves run on the surveyed snapshot; `snapshot`, `flows` and `findings` are its survey. */
export interface Priced extends Survey {
  applied: Choices;
  catalogs: Catalogs;
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

const solved = new WeakMap<DuctSnapshot, WeakMap<Grids, WeakMap<Catalogs, Solved>>>();

function solvedFor(snapshot: DuctSnapshot, grids: Grids, catalogs: Catalogs): Solved {
  const byGrids = solved.get(snapshot) ?? solved.set(snapshot, new WeakMap()).get(snapshot)!;
  const byCatalogs = byGrids.get(grids) ?? byGrids.set(grids, new WeakMap()).get(grids)!;
  let entry = byCatalogs.get(catalogs);
  if (!entry) {
    const applied = appliedChoices(snapshot);
    entry = {
      applied,
      now: computeLosses(snapshot, grids, applied, {}, {}, catalogs),
      last: null,
      fanouts: new Map(),
    };
    byCatalogs.set(catalogs, entry);
  }
  return entry;
}

/** Cached per (snapshot, grids) and, for the last one, per `doc`: callers may price freely. */
export function price(
  raw: DuctSnapshot,
  grids: Grids,
  doc: DuctsRouteDocument | null,
  catalogs: Catalogs = EMPTY_CATALOGS,
): Priced {
  const surveyed = survey(raw, doc);
  const { snapshot } = surveyed;
  const entry = solvedFor(snapshot, grids, catalogs);
  if (entry.last?.doc === doc) return entry.last.priced;
  const staged = stagedDucts(doc);
  const { applied, now } = entry;
  const choices = {
    ...applied,
    ...Object.fromEntries(Object.entries(staged.rules).map(([key, { table }]) => [key, table])),
  };
  const overrides: Overrides = {
    terminalCfm: Object.fromEntries(
      [...surveyed.flows].flatMap(([id, f]) =>
        f.cfm != null && f.source !== "revit" ? [[id, f.cfm]] : [],
      ),
    ),
    catalogLinks: staged.catalogs,
    terminalPs: byId(staged.terminalDrops, (drop) => drop.inWg),
    componentDrop: byId(staged.componentDrops, (drop) => drop.inWg),
  };
  const same =
    Object.keys(staged.catalogs).length === 0 &&
    Object.keys(staged.rules).length === 0 &&
    !hasDrops(staged) &&
    !Object.keys(overrides.terminalCfm!).length &&
    !Object.keys(staged.calculation).length;
  const priced: Priced = {
    ...surveyed,
    catalogs,
    applied,
    choices,
    overrides,
    now,
    next: same
      ? now
      : computeLosses(snapshot, grids, choices, overrides, staged.calculation, catalogs),
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
  const { fanouts } = solvedFor(snapshot, grids, priced.catalogs);
  const at = `${key}|${table.toUpperCase()}`;
  let f = fanouts.get(at);
  if (!f)
    fanouts.set(
      at,
      (f = fanout(snapshot, grids, priced.applied, key, table, {}, priced.now, priced.catalogs)),
    );
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

/** The air mover a group's fan static is written to: its one root, else its critical system's base. */
export function unitOf(snapshot: DuctSnapshot, result: LossResult, group: Group): number | null {
  const critical = result.byGroup[group.id]?.critical;
  return group.rootIds.length === 1
    ? group.rootIds[0]!
    : critical == null
      ? null
      : (systemFor(snapshot, critical)?.baseEquipmentId ?? null);
}

/**
 * Legacy classification arithmetic, not physical fan certification. Explicit staged fan/passive
 * roles suppress this unit scalar; physical circuit pressure is retained separately.
 */
export function proposedStatic(snapshot: DuctSnapshot, result: LossResult, unit: number) {
  const role = result.design.graph.parts.find((part) => part.elementId === unit)?.continuity;
  if (role === "passive" || role === "fan-boundary") return null;
  const byKind = new Map<string, number>();
  for (const group of snapshot.groups) {
    const solved = result.byGroup[group.id];
    if (!solved || solved.critical == null || unitOf(snapshot, result, group) !== unit) continue;
    const kind = group.classifications.join(",");
    byKind.set(kind, Math.max(byKind.get(kind) ?? 0, solved.fan));
  }
  const parts = [...byKind].map(([kind, fan]) => ({ kind, fan }));
  return parts.length ? { total: round4(parts.reduce((a, b) => a + b.fan, 0)), parts } : null;
}

/**
 * The native `ducts.apply` request (less `previewOnly`) from the staged cells only: every instance of a staged rule under
 * its chosen table (instances the table cannot price are left out, and the band says so), every
 * staged drop, the staged parameter slots, and the staged unit statics. `group` scopes the instances, drops
 * and unit to that group's nodes; empty is every group. The rules' chosen tables stay
 * document-wide.
 */
export function applyRequest(
  snapshot: DuctSnapshot,
  priced: Priced,
  appliedAt: string,
  group: string,
): DuctsApplyInput {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const inScope = (id: number) => !group || nodes.get(id)?.groupId === group;
  const unit = group
    ? snapshot.groups.filter((g) => g.id === group).map((g) => unitOf(snapshot, priced.now, g))[0]
    : undefined;
  const fittings = Object.keys(priced.staged.rules)
    .sort()
    .flatMap((ruleKey) =>
      [...instancesOf(priced.next, ruleKey).values()]
        // Inferred taps (negative ids) are survey assumptions, never Revit elements.
        .filter((row) => row.c != null && !row.error && row.id > 0 && inScope(row.id))
        .map((row) => ({
          id: row.id,
          // The Pe server charges the family's own coefficient when it has one, else prices the legs from this table.
          method: "pe-server" as const,
          coefficient: row.c!,
          table: row.table!,
          inputs: inputsOf(row),
          ruleKey,
        })),
    )
    .sort((a, b) => a.id - b.id);
  const drops = (cells: Priced["staged"]["terminalDrops"]) =>
    Object.entries(cells)
      .filter(([id]) => inScope(Number(id)))
      .map(([id, drop]) => ({ id: Number(id), inWg: drop.inWg, source: drop.source ?? null }))
      .sort((a, b) => a.id - b.id);
  // A staged link authorizes result writes, not a write to the family type's Pe_Catalog.
  const linked = Object.values(priced.next.paths).flatMap((path) =>
    path.rows.flatMap((row) => {
      const node = nodes.get(row.id);
      if (
        row.kind !== "terminal" ||
        row.dp == null ||
        !row.source ||
        !node ||
        !inScope(row.id) ||
        !stagedLink(priced.staged.catalogs, node)
      )
        return [];
      return [
        {
          id: row.id,
          inWg: row.dp,
          source: `${row.table}; ${row.source.file} p. ${row.source.page} (PDF ${row.source.pdfPage}); ${row.source.url}; total pressure; ${row.notes?.join("; ")}`,
        },
      ];
    }),
  );
  const terminals = [
    ...new Map([...linked, ...drops(priced.staged.terminalDrops)].map((t) => [t.id, t])).values(),
  ].sort((a, b) => a.id - b.id);
  const components = drops(priced.staged.componentDrops);
  const calculationOwners = new Set(
    Object.values(priced.staged.calculation).flatMap((e) =>
      e.kind === "fan" || e.kind === "passive" ? [e.element.id] : [],
    ),
  );
  if (Object.keys(priced.staged.unitStatics).some((id) => calculationOwners.has(Number(id))))
    throw Error(
      "Physical fan circuits have no admitted manufacturer scalar ESP mapping; clear the unit static cell. Circuit evidence is calculation-only.",
    );
  const equipment = Object.entries(priced.staged.unitStatics)
    .map(([id, { inWg }]) => ({ id: Number(id), externalStaticInWg: inWg }))
    .filter(({ id }) => !group || id === unit)
    .sort((a, b) => a.id - b.id);
  const slots = priced.staged.parameters;
  const stored = snapshot.store;
  return {
    slots,
    fittings,
    terminals,
    components,
    equipment,
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
