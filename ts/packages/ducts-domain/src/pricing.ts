/**
 * The losses view's model, pure: what Revit holds now (the applied tables), what the person
 * edit on top, the two solves, and the `ducts.apply` request built from the edit cells.
 * The solver is W2's (`losses.ts`); nothing here looks a coefficient up itself.
 */
import {
  stagedDucts,
  type DuctFinding,
  type DuctsApplyInput,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";

import { stagedLink, EMPTY_CATALOGS, type Catalogs } from "./catalog.ts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "./equivalent-length.ts";
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
import { storeRulings, withStoredRulings } from "./rulings.ts";
import { survey, type Survey } from "./survey.ts";
import { equipmentFlows, type EquipmentFlow } from "./terminal-flows.ts";
import type { DuctSnapshot } from "./types.ts";
import { unitRoles, type UnitRole } from "./unit-roles.ts";

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

/**
 * The unit overrides every solve reads: each root's role and each stated design flow. A derived
 * flow is never passed: the solve derives it per group from the grilles that group's fan serves
 * (`groupFans`), where the survey's per-unit reading is the largest over every group it roots.
 */
const unitOverrides = (
  roles: ReadonlyMap<number, UnitRole>,
  flows: ReadonlyMap<number, EquipmentFlow>,
): Pick<Overrides, "unitRole" | "unitCfm"> => ({
  unitRole: Object.fromEntries([...roles].map(([id, r]) => [id, r.role])),
  unitCfm: Object.fromEntries(
    [...flows].flatMap(([id, f]) =>
      f.cfm != null && f.cfm > 0 && f.source !== "derived" ? [[id, f.cfm]] : [],
    ),
  ),
});

/** The units as Revit holds them: stored rulings over roles proposed from Revit's own state, and each unit's stated flow. */
// Only immutable captured inputs are reused. Staged Work still prices separately below; refreshing
// Revit replaces the snapshot identity, so this cache cannot carry an old read into a new one.
const appliedUnitCache = new WeakMap<DuctSnapshot, ReturnType<typeof unitOverrides>>();
const appliedUnits = (raw: DuctSnapshot) => {
  const cached = appliedUnitCache.get(raw);
  if (cached) return cached;
  const stated = equipmentFlows(raw, {});
  const roles = unitRoles(raw, stated, stagedDucts(withStoredRulings(null, raw.store)).roles);
  const units = unitOverrides(roles, stated);
  appliedUnitCache.set(raw, units);
  return units;
};

const byId = <V>(cells: Record<string, V>, pick: (value: V) => number) =>
  Object.fromEntries(Object.entries(cells).map(([id, value]) => [Number(id), pick(value)]));

/**
 * The catalog findings a solve raises, one per terminal and kind: a table that is not loaded and an
 * input outside a loaded table's range. Both block the terminal's drop (`bins.ts`); the rows keep
 * their prose, this makes them findings the inbox can hold.
 */
export function catalogFindings(result: LossResult): DuctFinding[] {
  const found = new Map<string, DuctFinding>();
  // A fitting no rule prices: one finding per family (or per element with no family), its elements
  // gathered, so the inbox asks once for a drop and the rules popover once for a rule.
  const unruled = new Map<string, { family: string | null; ids: Set<number> }>();
  for (const path of Object.values(result.paths))
    for (const row of path.rows)
      if (row.finding === "no-rule") {
        const key = row.family ?? `#${row.id}`;
        const at = unruled.get(key) ?? { family: row.family ?? null, ids: new Set<number>() };
        at.ids.add(row.id);
        unruled.set(key, at);
      }
  for (const [key, { family, ids }] of unruled)
    found.set(`no-rule:${key}`, {
      id: `no-rule:${key}`,
      kind: "no-rule",
      elementIds: [...ids].sort((a, b) => a - b),
      note: family
        ? `No loss rule prices the family ${family}; state a drop on one of them, or price the family as a rule.`
        : "No loss rule prices this fitting; state its drop.",
      assumed: null,
      clearer: "person",
    });
  for (const path of Object.values(result.paths))
    for (const row of path.rows)
      if (row.finding === "catalog-missing-table" || row.finding === "catalog-out-of-range")
        found.set(`catalog:${row.finding}:${row.id}`, {
          id: `catalog:${row.finding}:${row.id}`,
          kind: row.finding,
          elementIds: [row.id],
          note: row.error ?? row.finding,
          assumed: null,
          clearer: "person",
        });
  return [...found.values()];
}

/**
 * The findings the plausibility guards raise. `implausible-loss`: a fitting row whose coefficient or
 * velocity is past the limits (`IMPLAUSIBLE_*` in losses.ts); it blocks (`bins.ts`) and its path
 * prices nothing. `mixed-classification`: an element a terminal of another air classification
 * was kept off (`flowBelow`); a diagnostic that names the element.
 */
export function guardFindings(result: LossResult): DuctFinding[] {
  const rows = [
    ...Object.values(result.paths).flatMap((p) => p.rows),
    ...Object.values(result.byGroup).flatMap((g) =>
      g.fans.flatMap((f) => [...f.stretch, ...f.rows]),
    ),
  ];
  const found = new Map<string, DuctFinding>();
  for (const row of rows)
    if (row.implausible)
      found.set(`implausible:${row.id}`, {
        id: `implausible:${row.id}`,
        kind: "implausible-loss",
        elementIds: [row.id],
        note: row.error!,
        assumed: null,
        clearer: "person",
      });
  for (const c of result.crossClass)
    found.set(`mixed-classification:el:${c.id}:${c.from}`, {
      id: `mixed-classification:el:${c.id}:${c.from}`,
      kind: "mixed-classification",
      elementIds: [c.id, c.from],
      note: `${Math.round(c.cfm)} cfm of ${c.fromClassification} air below ${c.from} is kept off ${c.classification} element ${c.id}`,
      assumed: null,
      clearer: "person",
    });
  return [...found.values()];
}

/** The solves run on the surveyed snapshot; `snapshot`, `flows` and `findings` are its survey (findings also carry the solve's catalog findings). */
export interface Priced extends Survey {
  applied: Choices;
  catalogs: Catalogs;
  /** Applied plus edit: what apply would leave in Revit. */
  choices: Choices;
  overrides: Overrides;
  /** The solve as Revit holds it now. */
  now: LossResult;
  /** The solve with every edit cell landed. */
  next: LossResult;
  edit: ReturnType<typeof stagedDucts>;
}

const completed = new WeakMap<
  DuctSnapshot,
  {
    grids: Grids;
    catalogs: Catalogs;
    doc: DuctsRouteDocument | null;
    priced: Priced;
  }
>();

/** Admit an exact worker answer for synchronous consumers; callers fence its input generation first. */
export function rememberPrice(
  raw: DuctSnapshot,
  grids: Grids,
  doc: DuctsRouteDocument | null,
  catalogs: Catalogs,
  priced: Priced,
) {
  completed.set(raw, { grids, doc, catalogs, priced });
}

/**
 * What depends on (snapshot, grids) alone, kept so a Work change re-solves only `next`: the
 * applied solve, the last priced Work, and each edit rule's fanout.
 */
interface Solved {
  applied: Choices;
  now: LossResult;
  /** The design friction rate `now` was read at (it only moves a part with no duct on its path). */
  rate: number;
  last: { doc: DuctsRouteDocument | null; priced: Priced } | null;
  fanouts: Map<string, Fanout>;
}

const solved = new WeakMap<DuctSnapshot, WeakMap<Grids, WeakMap<Catalogs, Solved>>>();

function solvedFor(
  snapshot: DuctSnapshot,
  grids: Grids,
  catalogs: Catalogs,
  inferred: Survey["inferred"] = [],
  units: Overrides = {},
): Solved {
  const byGrids = solved.get(snapshot) ?? solved.set(snapshot, new WeakMap()).get(snapshot)!;
  const byCatalogs = byGrids.get(grids) ?? byGrids.set(grids, new WeakMap()).get(grids)!;
  let entry = byCatalogs.get(catalogs);
  if (!entry) {
    const applied = appliedChoices(snapshot);
    entry = {
      applied,
      // The tolerated snapshot is its survey's, so its inferred links are fixed with it.
      now: computeLosses(snapshot, grids, applied, units, {}, catalogs, inferred),
      rate: DEFAULT_DESIGN_FRICTION_RATE,
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
  const hit = completed.get(raw);
  if (hit?.grids === grids && hit.catalogs === catalogs && hit.doc === doc) return hit.priced;
  const surveyed = survey(raw, doc);
  const { snapshot } = surveyed;
  const units = appliedUnits(raw);
  const entry = solvedFor(snapshot, grids, catalogs, surveyed.inferred, units);
  if (entry.last?.doc === doc) return entry.last.priced;
  // The model's stored rulings under Work's pending ones (`rulings.ts`), as the survey read them.
  const edit = stagedDucts(withStoredRulings(doc, raw.store));
  const rate = edit.designFriction ?? DEFAULT_DESIGN_FRICTION_RATE;
  if (entry.rate !== rate) {
    entry.now = computeLosses(
      snapshot,
      grids,
      entry.applied,
      { ...units, designFrictionRate: rate },
      {},
      catalogs,
      surveyed.inferred,
    );
    entry.rate = rate;
  }
  const { applied, now } = entry;
  const choices = {
    ...applied,
    ...Object.fromEntries(Object.entries(edit.rules).map(([key, { table }]) => [key, table])),
  };
  const overrides: Overrides = {
    terminalCfm: Object.fromEntries(
      [...surveyed.flows].flatMap(([id, f]) =>
        f.cfm != null && f.source !== "revit" ? [[id, f.cfm]] : [],
      ),
    ),
    catalogLinks: edit.catalogs,
    ruleAssignment: Object.fromEntries(
      Object.entries(edit.ruleAssignments).map(([family, { rule }]) => [family, rule]),
    ),
    terminalPs: byId(edit.terminalDrops, (drop) => drop.inWg),
    componentDrop: byId(edit.componentDrops, (drop) => drop.inWg),
    ...unitOverrides(surveyed.roles, surveyed.equipmentFlows),
    designFrictionRate: rate,
  };
  const same =
    Object.keys(edit.catalogs).length === 0 &&
    Object.keys(edit.ruleAssignments).length === 0 &&
    Object.keys(edit.rules).length === 0 &&
    !hasDrops(edit) &&
    !Object.keys(overrides.terminalCfm!).length &&
    !Object.keys(edit.roles).length &&
    !Object.keys(edit.equipmentFlows).length &&
    !Object.keys(edit.calculation).length;
  const next = same
    ? now
    : computeLosses(
        snapshot,
        grids,
        choices,
        overrides,
        edit.calculation,
        catalogs,
        surveyed.inferred,
      );
  const priced: Priced = {
    ...surveyed,
    findings: [...surveyed.findings, ...catalogFindings(next), ...guardFindings(next)],
    catalogs,
    applied,
    choices,
    overrides,
    now,
    next,
    edit,
  };
  entry.last = { doc, priced };
  rememberPrice(raw, grids, doc, catalogs, priced);
  return priced;
}
const hasDrops = (edit: Priced["edit"]) =>
  Object.keys(edit.terminalDrops).length + Object.keys(edit.componentDrops).length > 0;

/** The table a rule is looked up under: edit, else applied, else its default. */
export const tableOf = (priced: Pick<Priced, "choices">, key: string) =>
  (priced.choices[key] ?? ruleByKey(key)?.table ?? "").toUpperCase();

/** What staging one rule's table moves, against the applied state (W2's `fanout`). */
export function stagedFanout(
  snapshot: DuctSnapshot,
  grids: Grids,
  priced: Priced,
  key: string,
): Fanout | null {
  const table = priced.edit.rules[key]?.table;
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

/**
 * The air mover a group's fan static is written to: its one root, else its largest fan when the
 * solve split it per fan, else its critical system's base.
 */
export function unitOf(snapshot: DuctSnapshot, result: LossResult, group: Group): number | null {
  const critical = result.byGroup[group.id]?.critical;
  const lead = result.byGroup[group.id]?.fans[0]?.unit;
  return group.rootIds.length === 1
    ? group.rootIds[0]!
    : lead != null
      ? lead
      : critical == null
        ? null
        : (systemFor(snapshot, critical)?.baseEquipmentId ?? null);
}

/**
 * Legacy classification arithmetic, not physical fan certification. Explicit edit fan/passive
 * roles suppress this unit scalar; physical circuit pressure is retained separately.
 */
export function proposedStatic(snapshot: DuctSnapshot, result: LossResult, unit: number) {
  const role = result.design.graph.parts.find((part) => part.elementId === unit)?.continuity;
  if (role === "passive" || role === "fan-boundary") return null;
  const byKind = new Map<string, number>();
  for (const group of snapshot.groups) {
    const solved = result.byGroup[group.id];
    // A blocked group has no price: no ESP is proposed for its unit (never written to Revit).
    if (solved?.implausible.length) continue;
    // A fan of a multi-fan group delivers its own section's ESP (`fan-sections.ts`).
    const own = solved?.fans.find((f) => f.unit === unit);
    const fan = own
      ? own.critical == null && !own.stretch.length
        ? null
        : own.esp
      : solved?.critical != null && unitOf(snapshot, result, group) === unit
        ? solved.fan
        : null;
    if (fan == null) continue;
    const kind = group.classifications.join(",");
    byKind.set(kind, Math.max(byKind.get(kind) ?? 0, fan));
  }
  const parts = [...byKind].map(([kind, fan]) => ({ kind, fan }));
  return parts.length ? { total: round4(parts.reduce((a, b) => a + b.fan, 0)), parts } : null;
}

/**
 * The native `ducts.apply` request (less `previewOnly`) from the edit cells only: every instance of a edit rule under
 * its chosen table (instances the table cannot price are left out, and the band says so), every
 * edit drop, the edit parameter slots, the edit `esp`, the resolved flow of every terminal in a
 * priced group (a group with an air mover; every precedence rung, so Revit's own value is carried
 * with its source) and the edit `equipmentFlows`. `groups` scopes the instances, drops, flows and
 * units to those groups (a system's: every group it is in, `system-scope.ts`); empty is every
 * group. The rules' chosen tables stay document-wide.
 */
export function applyRequest(
  snapshot: DuctSnapshot,
  priced: Priced,
  appliedAt: string,
  groups: readonly string[],
): DuctsApplyInput {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const scoped = new Set(groups);
  const inScope = (id: number) => !scoped.size || scoped.has(nodes.get(id)?.groupId ?? "");
  const fittings = Object.keys(priced.edit.rules)
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
  const drops = (cells: Priced["edit"]["terminalDrops"]) =>
    Object.entries(cells)
      .filter(([id]) => inScope(Number(id)))
      .map(([id, drop]) => ({ id: Number(id), inWg: drop.inWg, source: drop.source ?? null }))
      .sort((a, b) => a.id - b.id);
  // A edit link authorizes result writes, not a write to the family type's Pe_Catalog.
  const linked = Object.values(priced.next.paths).flatMap((path) =>
    path.rows.flatMap((row) => {
      const node = nodes.get(row.id);
      if (
        row.kind !== "terminal" ||
        row.dp == null ||
        !row.source ||
        !node ||
        !inScope(row.id) ||
        !stagedLink(priced.edit.catalogs, node)
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
    ...new Map([...linked, ...drops(priced.edit.terminalDrops)].map((t) => [t.id, t])).values(),
  ].sort((a, b) => a.id - b.id);
  const components = drops(priced.edit.componentDrops);
  const flowWrite = (id: number, cfm: number, source: string | null) => ({ id, cfm, source });
  const terminalFlows = snapshot.nodes
    .filter(
      (node) =>
        node.kind === "terminal" &&
        inScope(node.id) &&
        priced.next.byGroup[node.groupId ?? ""]?.hasAirMover,
    )
    .flatMap((node) => {
      const flow = priced.flows.get(node.id);
      if (flow?.cfm == null) return [];
      const stated = priced.edit.flows[String(node.id)]?.source;
      return [
        flowWrite(
          node.id,
          flow.cfm,
          flow.source === "override" ? (stated ?? "override") : flow.source,
        ),
      ];
    })
    .sort((a, b) => a.id - b.id);
  const roots = new Set(snapshot.groups.filter((g) => scoped.has(g.id)).flatMap((g) => g.rootIds));
  const equipmentFlows = Object.entries(priced.edit.equipmentFlows)
    .map(([id, flow]) => flowWrite(Number(id), flow.cfm, flow.source ?? null))
    // Any unit rooted in the group, not the baseline's one pick (it is blind to a edit passive role).
    .filter(({ id }) => !scoped.size || roots.has(id))
    .sort((a, b) => a.id - b.id);
  const calculationOwners = new Set(
    Object.values(priced.edit.calculation).flatMap((e) =>
      e.kind === "fan" || e.kind === "passive" ? [e.element.id] : [],
    ),
  );
  if (Object.keys(priced.edit.esp).some((id) => calculationOwners.has(Number(id))))
    throw Error(
      "Physical fan circuits have no admitted manufacturer scalar ESP mapping; clear the esp cell. Circuit evidence is calculation-only.",
    );
  // A unit of a group an implausible row blocks is never written an ESP: that group has no price.
  const blockedUnits = new Set(
    snapshot.groups.flatMap((group) =>
      priced.next.byGroup[group.id]?.implausible.length
        ? [...group.rootIds, unitOf(snapshot, priced.next, group) ?? -1]
        : [],
    ),
  );
  const equipment = Object.entries(priced.edit.esp)
    .map(([id, { inWg }]) => ({ id: Number(id), externalStaticInWg: inWg }))
    .filter(({ id }) => !blockedUnits.has(id))
    // Any unit rooted in the group, not the baseline's one pick (it is blind to a edit passive role).
    .filter(({ id }) => !scoped.size || roots.has(id))
    .sort((a, b) => a.id - b.id);
  const slots = priced.edit.parameters;
  const stored = snapshot.store;
  return {
    slots,
    fittings,
    terminals,
    components,
    equipment,
    terminalFlows,
    equipmentFlows,
    // The native op writes the store as sent: the model's store (unknown keys included) with
    // this apply over it, at the revision read, so a store that moved since refuses as stale.
    store: {
      ...stored,
      version: 2,
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
      terminalFlows: {
        ...stored?.terminalFlows,
        ...Object.fromEntries(
          terminalFlows.map(({ id, cfm, source }) => [String(id), { cfm, source, appliedAt }]),
        ),
      },
      equipmentFlows: {
        ...stored?.equipmentFlows,
        ...Object.fromEntries(
          equipmentFlows.map(({ id, cfm, source }) => [String(id), { cfm, source, appliedAt }]),
        ),
      },
      slots: Object.fromEntries(
        Object.entries({ ...snapshot.slots, ...slots }).filter(([, name]) => !!name),
      ),
      // Document-wide: the stored rulings Work leaves standing and its pending ones (`rulings.ts`).
      ...storeRulings(priced.edit, stored, appliedAt),
      workRevision: stored?.workRevision ?? 0,
      appliedAt,
    },
  };
}

/** Rule instances a edit table cannot price: left out of the write, named in the band. */
export const unpriced = (priced: Priced, key: string) =>
  [...instancesOf(priced.next, key).values()].filter((row) => row.c == null || row.error).length;
