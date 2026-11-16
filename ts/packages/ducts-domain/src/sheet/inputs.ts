import { elementSubject } from "../work-subject.ts";
import { criteriaCellOf, resolveValue, type DuctsCriteriaCell, type ValueCell, type ValueLayers, type ValueSource } from "@pe/agent-contracts";
/** Duct-specific acquisition feeds the shared Work resolver; observed parameters and catalogs belong to the model layer. */
import type {
  DuctUnitKind,
  DuctsCriteriaLayer,
  DuctsCriteriaValues,
  DuctsFirm,
  DuctsInputs,
  SheetEdits,
  Resolved,
} from "@pe/agent-contracts";
import type { Author } from "@pe/agent-contracts";
import { catalogLinkKey, catalogLoss, type Catalogs } from "../catalog.ts";
import type { SourcedValue } from "@pe/agent-contracts";
import { ENCOUNTER_KEY, type EncounterRuling } from "./encounters.ts";
import { slotFlowOf } from "../kernel/terminal-flow.ts";
import { suggestKind, suggestRole } from "../roster.ts";
import type { SheetSnapshot } from "./build.ts";

type Node = SheetSnapshot["nodes"][number];

/**
 * One staged cell at the Work-to-resolver seam (contract amendment 2): the value, the host-stamped
 * caller, and the cited ref or the cell's location `work:<work>/<segment>/<row>`. Airflow is a number.
 */
export interface WorkCell<T> {
  value: T;
  by: Author;
  ref: string;
}
type Cells<T> = Readonly<Record<string, WorkCell<T>>>;
/** Work's staged edits, as `stagedDucts(doc)` shapes them; every segment optional so tests pass literals. */
export interface WorkLayer {
  flows?: Cells<number>;
  terminalDrops?: Cells<number>;
  componentDrops?: Cells<number>;
  /** Staged required ESP (Q2): never rated, never pressure authority. */
  esp?: Cells<number>;
  equipmentFlows?: Cells<number>;
  roles?: Cells<"fan" | "passive">;
  kinds?: Cells<DuctUnitKind>;
  criteria?: DuctsCriteriaLayer;
  /** Who staged each criterion cell and its ref (`criteriaMeta`); a criterion with none resolves invalid. */
  criteriaMeta?: Partial<Record<DuctsCriteriaCell, Pick<WorkCell<unknown>, "by" | "ref">>>;
  /** Loss-rule key to table (Work `rules`). */
  rules?: Cells<string>;
  /** Fitting family to the rule key it is priced as where no rule matches (Work `ruleAssignments`). */
  ruleAssignments?: Cells<string>;
  catalogs?: Cells<string>;
  /**
   * `join:<a>|<b>` and `open-end:<id>:<connector>` verdict cells; `component-drop:<family>` overrides;
   * `component-drop:proposed:<pair>><toward>` a typed drop on one path through a proposed fitting.
   */
  assumptions?: Cells<{ kind: string; verdict?: string; inWg?: number }>;
}

/** A staged cell as a value layer: its caller is the author, its ref the evidence. */
const staged = <T, V = T>(
  cell: WorkCell<T> | undefined,
  value: (v: T) => V | null | undefined = (v) => v as unknown as V,
): ValueCell<V> => ({ value: cell ? value(cell.value) : undefined, author: cell?.by ?? null, ref: cell?.ref });
/** A Work criterion as a value layer: the author is its cell's `by`. */
const authored = <T>(
  layer: WorkLayer | null | undefined,
  cell: DuctsCriteriaCell,
  value: T | undefined,
): ValueCell<T> => ({
  value,
  author: layer?.criteriaMeta?.[cell]?.by ?? null,
  ref: layer?.criteriaMeta?.[cell]?.ref ?? `work:ducts/criteria/${cell}`,
});
/** Every model, store, project, firm and default layer cell: no author, and a ref of its tier and location. */
const observed = <T>(
  tier: string,
  at: string | number,
  value: T | null | undefined,
  version?: string | number,
): ValueCell<T> => ({
  value,
  author: null,
  ref: `${tier}:${at}`,
  ...(version == null ? {} : { version }),
});

/** Where a retired authored value lives: Pe's provenance store parameter on Project Information. */
const STORE = "_PE_DuctLosses";

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

/** The Work cells a sheet's `edits` touches, as document paths: one per record key, the one `criteria` cell, and the `assumptions` cell of each join, end and proposed-path drop. */
export function editCells(edits: SheetEdits): string[][] {
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

/** A drop parameter identical on every instance of a family (two or more) is the family's placeholder, not a design value: Chadds' 302 volume dampers all carry 1.0 in-wg (2026-10-28). */
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
    immediate: T | undefined,
    cell: DuctsCriteriaCell,
  ): Resolved<T> => {
    // The base is labelled by the tier that served this cell (ADR 0037 rule 8), never "firm" by default of thought.
    const tier = firm.served?.[cell] ?? "firm";
    const result = resolveValue(
      {
        run: authored(run, cell, immediate),
        Work: authored(work, cell, typed),
        "model-store": observed("model-store", `criteria.${cell}/${STORE}`, stored),
        [tier]: observed(tier, cell, base, tier === "firm" ? firm.version : undefined),
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
      criteriaCellOf(key)!,
    );
  // Each side resolves on its own: typing return keeps supply's source (ducts LEDGER, sided criteria).
  const sided = (key: Sided) => ({
    supply: layered(
      work?.criteria?.[key]?.supply,
      store?.criteria?.[key]?.supply,
      firm.criteria[key].supply,
      key === "velocityLimitFpm" ? "fpm" : "in-wg",
      run?.criteria?.[key]?.supply,
      criteriaCellOf(key, "supply")!,
    ),
    return: layered(
      work?.criteria?.[key]?.return,
      store?.criteria?.[key]?.return,
      firm.criteria[key].return,
      key === "velocityLimitFpm" ? "fpm" : "in-wg",
      run?.criteria?.[key]?.return,
      criteriaCellOf(key, "return")!,
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
  const pick = <T>(
    values: ValueLayers<T>,
    units: string | null = null,
    valid: (value: T) => boolean = (value) =>
      typeof value !== "number" || (Number.isFinite(value) && value >= 0),
  ): Resolved<T | null> =>
    resolveValue(
      Object.fromEntries(
        Object.entries(values).map(([source, cell]) => [
          source,
          { ...cell, version: cell.version ?? layers.versions?.[source as ValueSource] },
        ]),
      ),
      units,
      valid,
    );
  const store = layers.store ?? {};
  const slots: Partial<NonNullable<SheetSnapshot["slots"]>> = snapshot.slots ?? {};

  const criteria = resolveCriteria(work, store, firm, run, layers.versions);
  // A part's typed drop, else the drop its family was given (`component-drop:<family>`).
  const typedDropOf = (key: string, family: string | null | undefined): ValueCell<number> =>
    work.componentDrops?.[key]
      ? staged(work.componentDrops[key])
      : staged(family ? work.assumptions?.[`component-drop:${family}`] : undefined, (a) => a.inWg);

  const flowSlot = slots.terminalFlow ?? "terminalFlow";
  const terminals: DuctsInputs["terminals"] = {};
  const units: DuctsInputs["units"] = {};
  const components: DuctsInputs["components"] = {};
  const placeholders = familyPlaceholders(snapshot);
  for (const n of snapshot.nodes) {
    const id = String(n.id), key = elementSubject(n);
    if (n.kind === "terminal") {
      const stored = store.terminalFlows?.[id]?.cfm;
      const revit = slotFlowOf(n, flowSlot).cfm;
      const cfm = pick(
        {
          run: staged(run.flows?.[key]),
          Work: staged(work.flows?.[key]),
          "model-store": observed("model-store", `${id}/${STORE}`, stored),
          model: observed("model", `${id}/${flowSlot}`, positive(revit)),
        },
        "cfm",
      );
      const storedDrop = store.terminals?.[id]?.inWg;
      const dropCell = criteriaCellOf("terminalDropInWg")!;
      const tables = Object.fromEntries(
        Object.entries(work.catalogs ?? {}).map(([k, c]) => [k, { table: c.value }]),
      );
      const catalog =
        catalogs && Object.keys(catalogs).length
          ? catalogLoss(n, cfm.value, catalogs, tables)
          : null;
      const parameter = positive(n.terminalDrop?.catalogDropInWg);
      const drop = pick(
        {
          run: run.terminalDrops?.[key]
            ? staged(run.terminalDrops[key])
            : authored(run, dropCell, run.criteria?.terminalDropInWg),
          Work: work.terminalDrops?.[key]
            ? staged(work.terminalDrops[key])
            : authored(work, dropCell, work.criteria?.terminalDropInWg),
          "model-store": observed("model-store", `${id}/${STORE}`, storedDrop ?? store.criteria?.terminalDropInWg),
          model: observed("model", `${id}/${catalog?.table ?? slots.terminalDrop ?? "terminalDrop"}`, catalog?.dp ?? parameter),
          // The per-terminal fallback is the criterion's base, under the tier that served it.
          [firm.served?.terminalDropInWg ?? "firm"]: observed(firm.served?.terminalDropInWg ?? "firm", dropCell, firm.criteria.terminalDropInWg, firm.version),
        },
        "in-wg",
      );
      terminals[id] = { cfm, drop };
    } else if (n.kind === "equipment") {
      const kindKey = catalogLinkKey(n.family, n.type);
      const suggestion = suggestKind(n);
      const kind = pick<DuctUnitKind>(
        {
          run: staged(run.kinds?.[kindKey]),
          Work: staged(work.kinds?.[kindKey]),
          "model-store": observed("model-store", `${kindKey}/${STORE}`, store.kinds?.[kindKey]?.kind as DuctUnitKind),
          default: observed("default", `${id}/${suggestion.ref}`, suggestion.kind),
        },
        null,
        isKind,
      ) as Resolved<DuctUnitKind>;
      const role = pick<"fan" | "passive">(
        {
          run: staged(run.roles?.[key]),
          Work: staged(work.roles?.[key]),
          "model-store": observed("model-store", `${id}/${STORE}`, store.roles?.[id]?.role as "fan" | "passive"),
          default: observed("default", `${id}/name`, suggestRole(n, kind.value)),
        },
        null,
        isRole,
      ) as Resolved<"fan" | "passive">;
      // Revit categorizes inline heaters and silencers as equipment. They need a part drop,
      if (kind.value === "other" && role.value === "passive" && n.connectors.length === 2) {
        components[id] = {
          drop: pick(
            {
              run: staged(run.componentDrops?.[key]),
              Work: typedDropOf(key, n.family),
              model: observed("model", `${id}/${slots.componentDrop ?? "Pressure Drop"}`, positive(factOf(n, "pressureDrop"))),
            },
            "in-wg",
          ),
        };
        continue;
      }
      const storedCfm = store.equipmentFlows?.[id]?.cfm;
      const revitCfm = positive(factOf(n, "fanFlow"));
      const cfm = pick(
        {
          run: staged(run.equipmentFlows?.[key]),
          Work: staged(work.equipmentFlows?.[key]),
          "model-store": observed("model-store", `${id}/${STORE}`, storedCfm),
          model: observed("model", `${id}/${slots.fanFlow ?? "fanFlow"}`, revitCfm),
        },
        "cfm",
      );
      // Q2 (kaitpw 2026-11-16): rated ESP reads the model alone. A staged required ESP is another
      // value with another source (`stagedEsp`) and never demotes or replaces this one.
      const esp = pick(
        {
          model: observed("model", `${id}/${slots.fanStatic ?? "fanStatic"}`, positive(factOf(n, "externalStatic"))),
        },
        "in-wg",
      );
      units[id] = { kind, role, cfm, esp };
      if (work.componentDrops?.[key] || run.componentDrops?.[key])
        components[id] = {
          drop: pick(
            { run: staged(run.componentDrops?.[key]), Work: staged(work.componentDrops?.[key]) },
            "in-wg",
          ),
        };
    } else {
      // Accessories, fittings and caps: a drop only where something states one, or where a stated
      const typed = work.componentDrops?.[key]?.value;
      const family = n.family ? work.assumptions?.[`component-drop:${n.family}`]?.value.inWg : undefined;
      const stated = n.kind === "accessory" ? positive(factOf(n, "pressureDrop")) : null;
      const placeholder = n.family && stated != null ? placeholders.get(n.family) : undefined;
      if (
        typed != null ||
        family != null ||
        stated != null ||
        placeholder ||
        run.componentDrops?.[key]
      ) {
        const resolved = pick(
          {
            run: staged(run.componentDrops?.[key]),
            Work: typedDropOf(key, n.family),
            model: observed("model", `${id}/${slots.componentDrop ?? "Pressure Drop"}`, placeholder ? null : stated),
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
    const at = elementSubject(seg);
    if (work.componentDrops?.[at] || run.componentDrops?.[at])
      components[String(seg.id)] = {
        drop: pick(
          { run: staged(run.componentDrops?.[at]), Work: staged(work.componentDrops?.[at]) },
          "in-wg",
        ),
      };
  }

  const verdictOf = (a: { kind: string; verdict?: string }) => (a.kind === "verdict" ? a.verdict : null);
  const verdictAt = (key: string) =>
    resolveValue({
      run: staged(run.assumptions?.[key], verdictOf),
      Work: staged(work.assumptions?.[key], verdictOf),
      "model-store": observed("model-store", `${key}/${STORE}`, store.verdicts?.[key]?.verdict),
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
      run: staged(run.rules?.[key]),
      Work: staged(work.rules?.[key]),
      "model-store": observed("model-store", `${key}/${STORE}`, store.rules?.[key]?.table),
    });
    if (value.value != null) tables[key] = value as Resolved<string>;
  }
  const assignments: DuctsInputs["assignments"] = {};
  for (const family of new Set([
    ...Object.keys(run.ruleAssignments ?? {}),
    ...Object.keys(work.ruleAssignments ?? {}),
  ])) {
    const value = pick({
      run: staged(run.ruleAssignments?.[family]),
      Work: staged(work.ruleAssignments?.[family]),
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
        run: staged(run.assumptions?.[key], (a) => a.inWg),
        Work: staged(work.assumptions?.[key], (a) => a.inWg),
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

/** A resolved number as the contract's sourced value; the kernel resolution already carries author and ref. */
export function sourced(r: Resolved<number | null> | undefined): SourcedValue<number> {
  if (!r || r.source === "none" || r.status === "missing")
    return { status: "missing", value: null, source: "none", author: null, ref: null, version: null, units: r?.units ?? null };
  const rest = { source: r.source, author: r.author, ref: r.ref ?? r.source, version: r.version, units: r.units };
  return r.status === "valid" && r.value != null
    ? { status: "valid", value: r.value, ...rest }
    : { status: "invalid", value: null, ...rest };
}

/** Staged required ESP by unit element id (Q2): the run and Work layers only, with who staged it. A cell no known caller staged resolves invalid (kernel law), never a guess. */
export function stagedEsp(
  layers: Pick<InputLayers, "snapshot" | "run" | "work">,
): Record<string, SourcedValue<number>> {
  return Object.fromEntries(
    layers.snapshot.nodes.flatMap((n) => {
      const key = elementSubject(n);
      const cell = layers.run?.esp?.[key] ?? layers.work?.esp?.[key];
      if (!cell) return [];
      const r = resolveValue(
        { [layers.run?.esp?.[key] ? "run" : "Work"]: staged(cell) },
        "in-wg",
        (v: number) => Number.isFinite(v) && v >= 0,
      );
      return [[String(n.id), r] as const];
    }),
  );
}

/** A person's encounter verdicts: `encounter:<element>:<connector>` assumption cells, `accept` or `refuse`. */
export function encounterRulings(layers: Pick<InputLayers, "run" | "work">): EncounterRuling[] {
  const cells = { ...layers.work?.assumptions, ...layers.run?.assumptions };
  return Object.entries(cells).flatMap(([key, cell]): EncounterRuling[] => {
    const [elementId, connector] = key.startsWith("encounter:") ? key.slice(10).split(":").map(Number) : [];
    const verdict = cell.value.verdict === "accept" ? "accepted" : cell.value.verdict === "refuse" ? "refused" : null;
    const at = { elementId: elementId!, connector: connector! };
    return verdict && Number.isInteger(elementId) && Number.isInteger(connector) && ENCOUNTER_KEY(at) === key
      ? [{ at, verdict }]
      : [];
  });
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

/** The inputs one sheet answers to: element-keyed values (terminals, units, components) and join or end rulings only where the sheet reaches (`ids`: its walked elements, the fan, the elements its blockers stand on). */
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
