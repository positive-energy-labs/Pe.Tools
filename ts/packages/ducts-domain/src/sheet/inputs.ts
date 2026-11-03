import { resolveValue, type ValueLayers, type ValueSource } from "@pe/agent-contracts";
/** Duct-specific acquisition feeds the shared Work resolver; observed parameters and catalogs belong to the model layer. */
import type {
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
  run?: WorkLayer | null;
  work?: WorkLayer | null;
  store?: StoreLayer | null;
  firm: DuctsFirm;
  catalogs?: Catalogs;
  versions?: Partial<Record<ValueSource, string | number>>;
}

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
  run?: WorkLayer | null,
  versions?: InputLayers["versions"],
): DuctsInputs["criteria"] {
  type Scalar = Exclude<keyof DuctsCriteriaValues, Sided>;
  type Sided = "velocityLimitFpm" | "allowanceInWg";
  const layered = <T>(
    typed: T | undefined,
    stored: T | undefined,
    base: T,
    units: string | null,
    immediate?: T,
  ): Resolved<T> => {
    const result = resolveValue(
      {
        run: { value: immediate },
        Work: { value: typed },
        model: { value: stored },
        firm: { value: base, version: firm.version },
      },
      units,
    );
    if (result.status !== "valid") throw new Error(`Invalid ducts criterion from ${result.source}`);
    return {
      ...result,
      version: result.version ?? versions?.[result.source as ValueSource] ?? null,
    } as Resolved<T>;
  };
  const criterion = <K extends Scalar>(key: K): Resolved<DuctsCriteriaValues[K]> =>
    layered(
      work?.criteria?.[key] as DuctsCriteriaValues[K] | undefined,
      store?.criteria?.[key] as DuctsCriteriaValues[K] | undefined,
      firm.criteria[key],
      key === "splitPolicy" ? null : key === "terminalDropInWg" ? "in-wg" : "in",
      run?.criteria?.[key] as DuctsCriteriaValues[K] | undefined,
    );
  // Each side resolves on its own: typing return keeps supply's source (ducts LEDGER, sided criteria).
  const sided = (key: Sided) => ({
    supply: layered(
      work?.criteria?.[key]?.supply,
      store?.criteria?.[key]?.supply,
      firm.criteria[key].supply,
      key === "velocityLimitFpm" ? "fpm" : "in-wg",
      run?.criteria?.[key]?.supply,
    ),
    return: layered(
      work?.criteria?.[key]?.return,
      store?.criteria?.[key]?.return,
      firm.criteria[key].return,
      key === "velocityLimitFpm" ? "fpm" : "in-wg",
      run?.criteria?.[key]?.return,
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
  const run = layers.run ?? {};
  const pick = <T>(values: ValueLayers<T>, units: string | null = null): Resolved<T | null> =>
    resolveValue(
      Object.fromEntries(
        Object.entries(values).map(([source, cell]) => [
          source,
          { ...cell, version: cell.version ?? layers.versions?.[source as ValueSource] },
        ]),
      ),
      units,
      (value) => typeof value !== "number" || (Number.isFinite(value) && value >= 0),
    );
  const store = layers.store ?? {};
  const slots: Partial<NonNullable<SheetSnapshot["slots"]>> = snapshot.slots ?? {};

  const criteria = resolveCriteria(work, store, firm, run, layers.versions);

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
      const cfm = pick(
        {
          run: { value: run.flows?.[id]?.cfm },
          Work: { value: typed },
          model: { value: stored ?? positive(revit), ref: flowSlot },
        },
        "cfm",
      );
      const typedDrop = work.terminalDrops?.[id]?.inWg;
      const storedDrop = store.terminals?.[id]?.inWg;
      const catalog =
        catalogs && Object.keys(catalogs).length
          ? catalogLoss(n, cfm.value, catalogs, work.catalogs ?? {})
          : null;
      const parameter = positive(n.terminalDrop?.catalogDropInWg);
      const drop = pick(
        {
          run: { value: run.terminalDrops?.[id]?.inWg ?? run.criteria?.terminalDropInWg },
          Work: { value: typedDrop ?? work.criteria?.terminalDropInWg },
          model: {
            value: storedDrop ?? store.criteria?.terminalDropInWg ?? catalog?.dp ?? parameter,
            ref: catalog?.table,
          },
          firm: { value: firm.criteria.terminalDropInWg, version: firm.version },
        },
        "in-wg",
      );
      terminals[id] = { cfm, drop };
    } else if (n.kind === "equipment") {
      const kindKey = catalogLinkKey(n.family, n.type);
      const suggestion = suggestKind(n);
      const kind = pick<DuctUnitKind>({
        run: { value: run.kinds?.[kindKey]?.kind },
        Work: { value: work.kinds?.[kindKey]?.kind },
        model: {
          value: isKind(store.kinds?.[kindKey]?.kind)
            ? (store.kinds![kindKey]!.kind as DuctUnitKind)
            : null,
        },
        default: { value: suggestion.kind, ref: suggestion.ref },
      }) as Resolved<DuctUnitKind>;
      const role = pick<"fan" | "passive">({
        run: { value: run.roles?.[id]?.role },
        Work: { value: work.roles?.[id]?.role },
        model: {
          value: isRole(store.roles?.[id]?.role)
            ? (store.roles![id]!.role as "fan" | "passive")
            : null,
        },
        default: { value: suggestRole(n, kind.value), ref: "name" },
      }) as Resolved<"fan" | "passive">;
      // Revit categorizes inline heaters and silencers as equipment. They need a part drop,
      // not fan sizing; recognized unit kinds and explicit fan rulings retain their unit inputs.
      if (kind.value === "other" && role.value === "passive" && n.connectors.length === 2) {
        components[id] = {
          drop: pick(
            {
              run: { value: run.componentDrops?.[id]?.inWg },
              Work: {
                value:
                  work.componentDrops?.[id]?.inWg ??
                  (n.family ? work.assumptions?.[`component-drop:${n.family}`]?.inWg : undefined),
              },
              model: { value: positive(factOf(n, "pressureDrop")), ref: slots.componentDrop ?? undefined },
            },
            "in-wg",
          ),
        };
        continue;
      }
      const typedCfm = work.equipmentFlows?.[id]?.cfm;
      const storedCfm = store.equipmentFlows?.[id]?.cfm;
      const revitCfm = positive(factOf(n, "fanFlow"));
      const cfm = pick(
        {
          run: { value: run.equipmentFlows?.[id]?.cfm },
          Work: { value: typedCfm },
          model: { value: storedCfm ?? revitCfm, ref: slots.fanFlow ?? "fanFlow" },
        },
        "cfm",
      );
      const esp = pick(
        {
          run: { value: run.esp?.[id]?.inWg },
          Work: { value: work.esp?.[id]?.inWg },
          model: {
            value: positive(factOf(n, "externalStatic")),
            ref: slots.fanStatic ?? "fanStatic",
          },
        },
        "in-wg",
      );
      units[id] = { kind, role, cfm, esp };
      const typedDrop = work.componentDrops?.[id]?.inWg;
      if (typedDrop != null || run.componentDrops?.[id])
        components[id] = {
          drop: pick(
            { run: { value: run.componentDrops?.[id]?.inWg }, Work: { value: typedDrop } },
            "in-wg",
          ),
        };
    } else {
      // Accessories, fittings and caps: a drop only where something states one, or where a stated
      // one is the family's placeholder (recorded as none, so the census can say why).
      const typed = work.componentDrops?.[id]?.inWg;
      const family = n.family ? work.assumptions?.[`component-drop:${n.family}`]?.inWg : undefined;
      const stated = n.kind === "accessory" ? positive(factOf(n, "pressureDrop")) : null;
      const placeholder = n.family && stated != null ? placeholders.get(n.family) : undefined;
      if (
        typed != null ||
        family != null ||
        stated != null ||
        placeholder ||
        run.componentDrops?.[id]
      ) {
        const resolved = pick(
          {
            run: { value: run.componentDrops?.[id]?.inWg },
            Work: { value: typed ?? family },
            model: {
              value: placeholder ? null : stated,
              ref: slots.componentDrop ?? "Pressure Drop",
            },
          },
          "in-wg",
        );
        // A missing value still needs the reason this model parameter was demoted.
        components[id] = {
          drop:
            resolved.status === "missing" && placeholder
              ? {
                  ...resolved,
                  ref: `family placeholder ${placeholder.inWg} on ${placeholder.count}`,
                }
              : resolved,
        };
      }
    }
  }

  // A duct priced by hand: a typed drop replaces its friction (segments carry no other drop source).
  for (const seg of snapshot.segments) {
    const typed = work.componentDrops?.[String(seg.id)]?.inWg;
    if (typed != null || run.componentDrops?.[String(seg.id)])
      components[String(seg.id)] = {
        drop: pick(
          { run: { value: run.componentDrops?.[String(seg.id)]?.inWg }, Work: { value: typed } },
          "in-wg",
        ),
      };
  }

  const verdictAt = (key: string) =>
    resolveValue({
      run: {
        value: run.assumptions?.[key]?.kind === "verdict" ? run.assumptions[key]!.verdict : null,
      },
      Work: {
        value: work.assumptions?.[key]?.kind === "verdict" ? work.assumptions[key]!.verdict : null,
      },
      model: { value: store.verdicts?.[key]?.verdict },
    }).value;
  const joins: DuctsInputs["rulings"]["joins"] = [];
  const ends: DuctsInputs["rulings"]["ends"] = [];
  const keys = new Set([
    ...Object.keys(run.assumptions ?? {}),
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
  for (const key of new Set([
    ...Object.keys(run.rules ?? {}),
    ...Object.keys(work.rules ?? {}),
    ...Object.keys(store.rules ?? {}),
  ])) {
    const value = pick({
      run: { value: run.rules?.[key]?.table },
      Work: { value: work.rules?.[key]?.table },
      model: { value: store.rules?.[key]?.table },
    });
    if (value.value != null) tables[key] = value as Resolved<string>;
  }
  const assignments: DuctsInputs["assignments"] = {};
  for (const family of new Set([
    ...Object.keys(run.ruleAssignments ?? {}),
    ...Object.keys(work.ruleAssignments ?? {}),
  ])) {
    const value = pick({
      run: { value: run.ruleAssignments?.[family]?.rule },
      Work: { value: work.ruleAssignments?.[family]?.rule },
    });
    if (value.value != null) assignments[family] = value as Resolved<string>;
  }
  const fittingDrops: DuctsInputs["fittingDrops"] = {};
  for (const key of new Set([
    ...Object.keys(run.assumptions ?? {}),
    ...Object.keys(work.assumptions ?? {}),
  ])) {
    if (!key.startsWith(`${COMPONENT_DROP}${PROPOSED}`)) continue;
    const value = pick(
      {
        run: { value: run.assumptions?.[key]?.inWg },
        Work: { value: work.assumptions?.[key]?.inWg },
      },
      "in-wg",
    );
    if (value.value != null)
      fittingDrops[key.slice(COMPONENT_DROP.length)] = value as Resolved<number>;
  }

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
