/**
 * The inputs resolver (ducts LEDGER 2026-10-29, "inputs split by nature"): every value the engine
 * prices from, resolved once from its layers into one `DuctsInputs` with a closed source. Pure:
 * the host loads the layers (Work's staged edits, the model's `_PE_DuctLosses` store as the
 * snapshot carries it, the firm file, the catalog tables) and the engine reads the result and
 * nothing else. Protocol (which parameter a slot names) is consumed here, at the boundary, and
 * never reaches the engine. Design values: typed, else catalog, else the Revit parameter, else the
 * firm default. Rulings: typed, else stored, else suggested. Criteria: project, else stored, else
 * firm, each side of a sided criterion on its own.
 */
import type {
  DuctInputSource,
  DuctUnitKind,
  DuctsCriteriaLayer,
  DuctsCriteriaValues,
  DuctsFirm,
  DuctsInputs,
  DuctsSheetEdits,
  Resolved,
} from "@pe/agent-contracts";
import { catalogLinkKey, catalogLoss, type Catalogs } from "../catalog.ts";
import { slotFlowOf } from "../kernel/terminal-flow.ts";
import { suggestKind, suggestRole } from "../roster.ts";
import type { SheetSnapshot } from "./build.ts";

type Node = SheetSnapshot["nodes"][number];

/** Work's staged edits, as `stagedDucts(doc)` shapes them; every segment optional so tests pass literals. */
export interface WorkLayer {
  flows?: Readonly<Record<string, { cfm: number }>>;
  terminalDrops?: Readonly<Record<string, { inWg: number }>>;
  componentDrops?: Readonly<Record<string, { inWg: number }>>;
  esp?: Readonly<Record<string, { inWg: number }>>;
  equipmentFlows?: Readonly<Record<string, { cfm: number }>>;
  roles?: Readonly<Record<string, { role: "fan" | "passive" }>>;
  kinds?: Readonly<Record<string, { kind: DuctUnitKind }>>;
  criteria?: DuctsCriteriaLayer;
  /** Loss-rule key to table (Work `rules`). */
  rules?: Readonly<Record<string, { table: string }>>;
  /** Fitting family to the rule key it is priced as where no rule matches (Work `ruleAssignments`). */
  ruleAssignments?: Readonly<Record<string, { rule: string }>>;
  catalogs?: Readonly<Record<string, { table: string }>>;
  /**
   * `join:<a>|<b>` and `open-end:<id>:<connector>` verdict cells; `component-drop:<family>` overrides;
   * `component-drop:proposed:<pair>><toward>` a typed drop on one path through a proposed fitting.
   */
  assumptions?: Readonly<Record<string, { kind: string; verdict?: string; inWg?: number }>>;
}

/** The model's store as the snapshot carries it; only the fields the resolver reads. */
export interface StoreLayer {
  verdicts?: Readonly<Record<string, { verdict: string }>>;
  roles?: Readonly<Record<string, { role: string }>>;
  kinds?: Readonly<Record<string, { kind: string }>>;
  criteria?: DuctsCriteriaLayer;
  rules?: Readonly<Record<string, { table?: string | null }>>;
  terminals?: Readonly<Record<string, { inWg: number }>>;
  terminalFlows?: Readonly<Record<string, { cfm: number }>>;
  equipmentFlows?: Readonly<Record<string, { cfm: number }>>;
}

export interface InputLayers {
  snapshot: SheetSnapshot;
  work?: WorkLayer | null;
  store?: StoreLayer | null;
  firm: DuctsFirm;
  catalogs?: Catalogs;
}

const r = <T>(value: T, source: DuctInputSource, ref?: string): Resolved<T> =>
  ref == null ? { value, source } : { value, source, ref };
const factOf = (n: Node, key: string) => n.facts.find((f) => f.key === key)?.value ?? null;
const positive = (v: number | null | undefined) => (v != null && v > 0 ? v : null);

export const JOIN_KEY = (pair: readonly [string, string]) => `join:${[...pair].sort().join("|")}`;
const COMPONENT_DROP = "component-drop:";
const PROPOSED = "proposed:";
/**
 * One path through a proposed fitting (a heal's tee or tap): the pair it joins and the main element
 * the branch path continues into, or `straight` for the run through it. Keys `inputs.fittingDrops`.
 */
export const PROPOSED_KEY = (pair: readonly [string, string], toward: number | "straight") =>
  `${PROPOSED}${[...pair].sort().join("|")}>${toward}`;
/** The Work `assumptions` cell a proposed path's typed drop lives in. */
export const FITTING_DROP_CELL = (key: string) => `${COMPONENT_DROP}${key}`;
export const END_KEY = (end: { elementId: number; connector: number }) =>
  `open-end:${end.elementId}:${end.connector}`;

/** The Work segment each record field of a sheet's `edits` writes, one cell per key. */
export const EDIT_SEGMENTS = {
  flows: "flows",
  terminalDrops: "terminalDrops",
  componentDrops: "componentDrops",
  esp: "esp",
  equipmentFlows: "equipmentFlows",
  roles: "roles",
  kinds: "kinds",
  tables: "rules",
  assignments: "ruleAssignments",
} as const;

/**
 * The Work cells a sheet's `edits` touches, as document paths: one per record key, the one
 * `criteria` cell, and the `assumptions` cell of each join, end and proposed-path drop. The host
 * writes exactly these (`editPatches`); the page snapshots them before an edit so undo restores
 * the cells as they were, a cleared cell's absence included.
 */
export function editCells(edits: DuctsSheetEdits): string[][] {
  const cells: string[][] = [];
  for (const [field, segment] of Object.entries(EDIT_SEGMENTS) as [
    keyof typeof EDIT_SEGMENTS,
    string,
  ][])
    for (const key of Object.keys(edits[field] ?? {})) cells.push([segment, key]);
  if (edits.criteria) cells.push(["criteria"]);
  for (const { pair } of edits.joins ?? []) cells.push(["assumptions", JOIN_KEY(pair)]);
  for (const key of Object.keys(edits.fittingDrops ?? {}))
    cells.push(["assumptions", FITTING_DROP_CELL(key)]);
  for (const { end } of edits.ends ?? []) cells.push(["assumptions", END_KEY(end)]);
  return cells;
}

/**
 * A drop parameter identical on every instance of a family (two or more) is the family's
 * placeholder, not a design value: Chadds' 302 volume dampers all carry 1.0 in-wg (2026-10-28).
 * ponytail: counts only the read's elements; C#'s document-wide census (health no-component-drop)
 * supersedes this when the snapshot carries it.
 */
function familyPlaceholders(snapshot: SheetSnapshot) {
  const values = new Map<string, (number | null)[]>();
  for (const n of snapshot.nodes)
    if (n.family && n.kind === "accessory")
      values.set(n.family, [...(values.get(n.family) ?? []), factOf(n, "pressureDrop")]);
  return new Map(
    [...values].flatMap(([family, vs]) =>
      vs.length > 1 && vs[0] != null && vs.every((v) => v === vs[0])
        ? [[family, { inWg: vs[0], count: vs.length }] as const]
        : [],
    ),
  );
}

/** The design criteria alone (no snapshot needed): what the C# read is asked to measure under. */
export function resolveCriteria(
  work: WorkLayer | null | undefined,
  store: StoreLayer | null | undefined,
  firm: DuctsFirm,
): DuctsInputs["criteria"] {
  type Scalar = Exclude<keyof DuctsCriteriaValues, Sided>;
  type Sided = "velocityLimitFpm" | "allowanceInWg";
  const layered = <T>(typed: T | undefined, stored: T | undefined, base: T): Resolved<T> =>
    typed !== undefined
      ? r(typed, "project")
      : stored !== undefined
        ? r(stored, "stored")
        : r(base, "firm", firm.version);
  const criterion = <K extends Scalar>(key: K): Resolved<DuctsCriteriaValues[K]> =>
    layered(
      work?.criteria?.[key] as DuctsCriteriaValues[K] | undefined,
      store?.criteria?.[key] as DuctsCriteriaValues[K] | undefined,
      firm.criteria[key],
    );
  // Each side resolves on its own: typing return keeps supply's source (ducts LEDGER, sided criteria).
  const sided = (key: Sided) => ({
    supply: layered(
      work?.criteria?.[key]?.supply,
      store?.criteria?.[key]?.supply,
      firm.criteria[key].supply,
    ),
    return: layered(
      work?.criteria?.[key]?.return,
      store?.criteria?.[key]?.return,
      firm.criteria[key].return,
    ),
  });
  return {
    velocityLimitFpm: sided("velocityLimitFpm"),
    terminalDropInWg: criterion("terminalDropInWg"),
    autoJoinGapIn: criterion("autoJoinGapIn"),
    healBoxIn: criterion("healBoxIn"),
    splitPolicy: criterion("splitPolicy"),
    allowanceInWg: sided("allowanceInWg"),
  };
}

export function resolveInputs(layers: InputLayers): DuctsInputs {
  const { snapshot, firm, catalogs } = layers;
  const work = layers.work ?? {};
  const store = layers.store ?? {};
  const slots: Partial<NonNullable<SheetSnapshot["slots"]>> = snapshot.slots ?? {};

  const criteria = resolveCriteria(work, store, firm);
  const terminalDropDefault = criteria.terminalDropInWg;

  const flowSlot = slots.terminalFlow ?? "terminalFlow";
  const terminals: DuctsInputs["terminals"] = {};
  const units: DuctsInputs["units"] = {};
  const components: DuctsInputs["components"] = {};
  const placeholders = familyPlaceholders(snapshot);
  for (const n of snapshot.nodes) {
    const id = String(n.id);
    if (n.kind === "terminal") {
      const typed = work.flows?.[id]?.cfm;
      const stored = store.terminalFlows?.[id]?.cfm;
      const revit = slotFlowOf(n, flowSlot).cfm;
      const cfm =
        typed != null
          ? r(typed, "typed")
          : stored != null
            ? r(stored, "stored")
            : revit != null && revit > 0
              ? r(revit, "revit", flowSlot)
              : r(null, "none", flowSlot);
      const typedDrop = work.terminalDrops?.[id]?.inWg;
      const storedDrop = store.terminals?.[id]?.inWg;
      const catalog =
        catalogs && Object.keys(catalogs).length
          ? catalogLoss(n, cfm.value, catalogs, work.catalogs ?? {})
          : null;
      const parameter = positive(n.terminalDrop?.catalogDropInWg);
      const drop =
        typedDrop != null
          ? r(typedDrop, "typed")
          : storedDrop != null
            ? r(storedDrop, "stored")
            : catalog && catalog.dp != null
              ? r(catalog.dp, "catalog", catalog.table)
              : parameter != null
                ? r(parameter, "revit", slots.terminalDrop ?? "terminalDrop")
                : r(terminalDropDefault.value, terminalDropDefault.source, terminalDropDefault.ref);
      terminals[id] = { cfm, drop };
    } else if (n.kind === "equipment") {
      const kindKey = catalogLinkKey(n.family, n.type);
      const kind =
        work.kinds?.[kindKey]?.kind != null
          ? r(work.kinds[kindKey]!.kind, "typed")
          : isKind(store.kinds?.[kindKey]?.kind)
            ? r(store.kinds![kindKey]!.kind as DuctUnitKind, "stored")
            : (({ kind, ref }) => r(kind, "suggested", ref))(suggestKind(n));
      const role =
        work.roles?.[id]?.role != null
          ? r(work.roles[id]!.role, "typed")
          : isRole(store.roles?.[id]?.role)
            ? r(store.roles![id]!.role as "fan" | "passive", "stored")
            : r(suggestRole(n, kind.value), "suggested", "name");
      const typedCfm = work.equipmentFlows?.[id]?.cfm;
      const storedCfm = store.equipmentFlows?.[id]?.cfm;
      const revitCfm = positive(factOf(n, "fanFlow"));
      const cfm =
        typedCfm != null
          ? r(typedCfm, "typed")
          : storedCfm != null
            ? r(storedCfm, "stored")
            : revitCfm != null
              ? r(revitCfm, "revit", slots.fanFlow ?? "fanFlow")
              : r(null, "none", slots.fanFlow ?? "fanFlow");
      const typedEsp = work.esp?.[id]?.inWg;
      const revitEsp = positive(factOf(n, "externalStatic"));
      const esp =
        typedEsp != null
          ? r(typedEsp, "typed")
          : revitEsp != null
            ? r(revitEsp, "revit", slots.fanStatic ?? "fanStatic")
            : r(null, "none", slots.fanStatic ?? "fanStatic");
      units[id] = { kind, role, cfm, esp };
      const typedDrop = work.componentDrops?.[id]?.inWg;
      if (typedDrop != null) components[id] = { drop: r(typedDrop, "typed") };
    } else {
      // Accessories, fittings and caps: a drop only where something states one, or where a stated
      // one is the family's placeholder (recorded as none, so the census can say why).
      const typed = work.componentDrops?.[id]?.inWg;
      const family = n.family ? work.assumptions?.[`component-drop:${n.family}`]?.inWg : undefined;
      const stated = n.kind === "accessory" ? positive(factOf(n, "pressureDrop")) : null;
      const placeholder = n.family && stated != null ? placeholders.get(n.family) : undefined;
      if (typed != null) components[id] = { drop: r(typed, "typed") };
      else if (family != null) components[id] = { drop: r(family, "typed", `family ${n.family}`) };
      else if (stated != null && !placeholder)
        components[id] = { drop: r(stated, "revit", slots.componentDrop ?? "Pressure Drop") };
      else if (placeholder)
        components[id] = {
          drop: r(null, "none", `family placeholder ${placeholder.inWg} on ${placeholder.count}`),
        };
    }
  }

  // A duct priced by hand: a typed drop replaces its friction (segments carry no other drop source).
  for (const seg of snapshot.segments) {
    const typed = work.componentDrops?.[String(seg.id)]?.inWg;
    if (typed != null) components[String(seg.id)] = { drop: r(typed, "typed") };
  }

  const verdictAt = (key: string) =>
    work.assumptions?.[key]?.kind === "verdict"
      ? work.assumptions[key]!.verdict
      : store.verdicts?.[key]?.verdict;
  const joins: DuctsInputs["rulings"]["joins"] = [];
  const ends: DuctsInputs["rulings"]["ends"] = [];
  const keys = new Set([
    ...Object.keys(work.assumptions ?? {}),
    ...Object.keys(store.verdicts ?? {}),
  ]);
  for (const key of keys) {
    const verdict = verdictAt(key);
    if (!verdict) continue;
    if (key.startsWith("join:")) {
      const pair = key.slice(5).split("|");
      if (pair.length === 2 && (verdict === "connect" || verdict === "ignore"))
        joins.push({
          pair: [pair[0]!, pair[1]!],
          verdict: verdict === "connect" ? "accept" : "reject",
        });
    } else if (key.startsWith("open-end:") && verdict === "capped") {
      const [elementId, connector] = key.slice(9).split(":").map(Number);
      if (Number.isInteger(elementId) && Number.isInteger(connector))
        ends.push({ end: { elementId: elementId!, connector: connector! }, verdict: "capped" });
    }
  }

  const tables: DuctsInputs["tables"] = {};
  for (const [key, cell] of Object.entries(store.rules ?? {}))
    if (cell.table) tables[key] = r(cell.table, "stored");
  for (const [key, cell] of Object.entries(work.rules ?? {})) tables[key] = r(cell.table, "typed");
  const assignments: DuctsInputs["assignments"] = {};
  for (const [family, cell] of Object.entries(work.ruleAssignments ?? {}))
    assignments[family] = r(cell.rule, "typed");
  const fittingDrops: DuctsInputs["fittingDrops"] = {};
  for (const [key, cell] of Object.entries(work.assumptions ?? {}))
    if (key.startsWith(`${COMPONENT_DROP}${PROPOSED}`) && cell.inWg != null)
      fittingDrops[key.slice(COMPONENT_DROP.length)] = r(cell.inWg, "typed");

  return {
    terminals,
    units,
    components,
    rulings: { joins, ends },
    criteria,
    tables,
    assignments,
    fittingDrops,
  };
}

const KINDS: readonly string[] = [
  "fan-coil",
  "air-handler",
  "erv",
  "muas",
  "dehumidifier",
  "other",
];
const isKind = (v: string | undefined): v is DuctUnitKind => v != null && KINDS.includes(v);
const isRole = (v: string | undefined): v is "fan" | "passive" => v === "fan" || v === "passive";

/** The resolved cfm of a terminal, for the engine's flow and for assumed fan flows. */
export const terminalCfmOf = (inputs: DuctsInputs, elementId: number): number | null =>
  inputs.terminals[String(elementId)]?.cfm.value ?? null;

/**
 * The inputs one sheet answers to: element-keyed values (terminals, units, components) and join or
 * end rulings only where the sheet reaches (`ids`: its walked elements, the fan, the elements its
 * blockers stand on). The resolver runs over the whole acquisition, which follows accepted joins
 * and returns the C# read's candidates, so it resolves units this fan never prices: MUAS-1 listed
 * UH-3 7939081 and FC-23 the louver's ERVs as "unnamed element" with their controls locked, and
 * FC-23 the louver join it never crosses (UI5, 2026-10-29). Document-wide inputs (criteria, rule
 * tables, family assignments, proposed-path drops) are kept whole.
 */
export function scopeInputs(inputs: DuctsInputs, ids: ReadonlySet<number>): DuctsInputs {
  const within = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(Number(id))));
  const reaches = (end: string) => ids.has(Number(end.split(":")[0]));
  return {
    ...inputs,
    terminals: within(inputs.terminals),
    units: within(inputs.units),
    components: within(inputs.components),
    rulings: {
      joins: inputs.rulings.joins.filter((j) => j.pair.some(reaches)),
      ends: inputs.rulings.ends.filter((e) => ids.has(e.end.elementId)),
    },
  };
}
