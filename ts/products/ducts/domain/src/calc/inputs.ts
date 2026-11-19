import { elementSubject } from "../work-subject.ts";
import { criteriaCellOf, resolveValue, type DuctsCriteriaCell, type ValueCell, type ValueLayers, type ValueSource } from "@pe/agent-contracts";
/** Duct-specific acquisition feeds the shared Work resolver; observed parameters and catalogs belong to the model layer. */
import type {
  DuctUnitKind,
  DuctsCriteriaLayer,
  DuctsCriteriaValues,
  DuctsFirm,
  DuctsInputs,
  CalcEdits,
  Resolved,
  Stated,
} from "@pe/agent-contracts";
import type { Author } from "@pe/agent-contracts";
import { DUCT_UNIT_KINDS } from "@pe/host-contracts/generated";
import { catalogLinkKey, catalogLoss, type Catalogs } from "../catalog.ts";
import type { SourcedValue } from "@pe/agent-contracts";
import { ENCOUNTER_KEY, type EncounterRuling } from "../encounter-ruling.ts";
import { slotFlowOf } from "../kernel/terminal-flow.ts";
import { suggestKind, suggestRole } from "../roster.ts";
import type { CalcSnapshot } from "../input-snapshot.ts";

type Node = CalcSnapshot["nodes"][number];

/**
 * One staged cell at the Work-to-resolver seam (contract amendment 2): the value, the host-stamped
 * caller, and the cited ref or the cell's location `work:<work>/<segment>/<row>`. Airflow is a number.
 */
export interface WorkCell<T> {
  value: T;
  by: Author;
  ref: string;
}
/** A stored cell the host could not read: no value and no caller, only why and where (P-040). */
type InvalidCell = { invalid: string; ref: string };
type Cells<T> = Readonly<Record<string, WorkCell<T> | InvalidCell>>;
/** Work's staged edits, as `stagedDucts(doc)` shapes them; every segment optional so tests pass literals. */
export interface WorkLayer {
  flows?: Cells<number>;
  terminalDrops?: Cells<number>;
  componentDrops?: Cells<number>;
  /** A fan's stated rated ESP, above the separately named model slot. */
  ratedEsp?: Cells<number>;
  equipmentFlows?: Cells<number>;
  roles?: Cells<"fan" | "passive">;
  kinds?: Cells<DuctUnitKind>;
  criteria?: DuctsCriteriaLayer;
  /** Who staged each criterion cell and its ref (`criteriaMeta`); a criterion with none resolves invalid. */
  criteriaMeta?: Partial<Record<DuctsCriteriaCell, Pick<WorkCell<unknown>, "by" | "ref"> | InvalidCell>>;
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
function staged<T>(cell: WorkCell<T> | InvalidCell | undefined): ValueCell<T>;
function staged<T, V>(cell: WorkCell<T> | InvalidCell | undefined, value: (v: T) => V | null | undefined): ValueCell<V>;
function staged<T>(cell: WorkCell<T> | InvalidCell | undefined, value: (v: T) => unknown = (v) => v): ValueCell<unknown> {
  if (cell && "invalid" in cell) return { value: null, invalid: cell.invalid, author: null, ref: cell.ref };
  return { value: cell ? value(cell.value) : undefined, author: cell?.by ?? null, ref: cell?.ref };
}
/** A Work criterion as a value layer: the author is its cell's `by`. */
const authored = <T>(
  layer: WorkLayer | null | undefined,
  cell: DuctsCriteriaCell,
  value: T | undefined,
): ValueCell<T> => {
  const meta = layer?.criteriaMeta?.[cell];
  return meta && "invalid" in meta ? { value: null, invalid: meta.invalid, author: null, ref: meta.ref }
    : { value, author: meta?.by ?? null, ref: meta?.ref ?? `work:duct-systems/criteria/${cell}` };
};
/** Every model, store, project, firm and default layer cell: no author, and a ref of its tier and location. */
export const observed = <T>(
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

/** Where a retired ruling lives, and Pe's receipts: the provenance store parameter on Project Information. */
const STORE = "_PE_DuctLosses";

/** The model's store as the snapshot carries it. Rulings (verdicts, roles, rules) resolve from it; the three value records are receipts of what Pe last wrote to a parameter, evidence beside the live read and never a rung (ADR 0053). */
export interface StoreLayer {
  verdicts?: Readonly<Record<string, { verdict: string }>>;
  roles?: Readonly<Record<string, { role: string }>>;
  rules?: Readonly<Record<string, { table?: string | null }>>;
  terminals?: Readonly<Record<string, { inWg: number }>>;
  terminalFlows?: Readonly<Record<string, { cfm: number }>>;
  equipmentFlows?: Readonly<Record<string, { cfm: number }>>;
}

export interface InputLayers {
  snapshot: CalcSnapshot;
  run?: WorkLayer | null;
  work?: WorkLayer | null;
  firm: DuctsFirm;
  catalogs?: Catalogs;
  versions?: Partial<Record<ValueSource, string | number>>;
}

const factOf = (n: Node, key: string) => n.facts.find((f) => f.key === key)?.value ?? null;
const positive = (v: number | null | undefined) => (v != null && v > 0 ? v : null);

type Slots = CalcSnapshot["slots"];
// One design value where Pe writes it: the slot parameter (`at`), what it reads now, and the receipt of what Pe last wrote there.
// The reader says null for an absent parameter and 0 for one that reads 0. A written parameter reads as it stands; an unwritten one states a value only when positive.
const written = (at: string, read: number | null | undefined, wrote: number | undefined, unit: string) => {
  const live = wrote == null ? positive(read) : (read ?? null);
  return { at, wrote, unit, live };
};
const WRITTEN = { // keyed by the Work segment that stages each value
  flows: (n: Node, slots: Slots, store: StoreLayer) =>
    written(slots.terminalFlow, slotFlowOf(n, slots.terminalFlow).cfm, store.terminalFlows?.[n.id]?.cfm, "cfm"),
  terminalDrops: (n: Node, slots: Slots, store: StoreLayer) => written(slots.terminalDrop, n.terminalDrop?.catalogDropInWg, store.terminals?.[n.id]?.inWg, "in-wg"),
  equipmentFlows: (n: Node, slots: Slots, store: StoreLayer) => written(slots.fanFlow, factOf(n, "fanFlow"), store.equipmentFlows?.[n.id]?.cfm, "cfm"),
};

/** Drift: the one place a receipt is compared with the live parameter. Null where Pe never wrote or the two agree; else what the cell says beside its value. Shown, never blocking, and no write re-asserts it. */
export function receiptDrift(snapshot: Pick<CalcSnapshot, "nodes" | "slots"> & { store?: StoreLayer | null }, segment: keyof typeof WRITTEN, id: number): string | null {
  const node = snapshot.nodes.find((n) => n.id === id);
  const { at, live, wrote, unit } = node ? WRITTEN[segment](node, snapshot.slots, snapshot.store ?? {}) : { at: "", live: null, wrote: undefined, unit: "" };
  if (wrote == null) return null;
  if (live == null) return `Pe wrote ${wrote} ${unit} to ${at}, which no longer reads`;
  // The reader rounds a slot parameter to 4 places (`Reading` in DuctSnapshots.cs); the receipt is unrounded, so they agree within half that step.
  return Math.abs(live - wrote) <= 0.5e-4 + 1e-9 ? null : `Changed in Revit since Pe wrote ${wrote} ${unit}`;
}

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
  equipmentFlows: "equipmentFlows",
  roles: "roles",
  kinds: "kinds",
  tables: "rules",
  assignments: "ruleAssignments",
} as const;

/** The Work cells a sheet's `edits` touches, as document paths: one per record key, the one `criteria` cell, and the `assumptions` cell of each join, end and proposed-path drop. */
export function editCells(edits: CalcEdits): string[][] {
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
function familyPlaceholders(snapshot: Pick<CalcSnapshot, "nodes">) {
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
const placeholderOf = (placeholders: ReturnType<typeof familyPlaceholders>, n: Node) =>
  n.family && n.kind === "accessory" && positive(factOf(n, "pressureDrop")) != null
    ? placeholders.get(n.family)
    : undefined;

/** The design criteria alone (no snapshot needed): what the C# read is asked to measure under. */
export function resolveCriteria(
  work: WorkLayer | null | undefined,
  firm: DuctsFirm,
  run?: WorkLayer | null,
  versions?: InputLayers["versions"],
): DuctsInputs["criteria"] {
  type Scalar = Exclude<keyof DuctsCriteriaValues, Sided>;
  type Sided = "velocityLimitFpm" | "allowanceInWg";
  const layered = <T>(
    typed: T | undefined,
    base: T,
    units: string | null,
    immediate: T | undefined,
    cell: DuctsCriteriaCell,
  ): Stated<T> => {
    // The base is labelled by the tier that served this cell (ADR 0037 rule 8), never "firm" by default of thought.
    const tier = firm.served?.[cell] ?? "firm";
    const result = resolveValue(
      {
        run: authored(run, cell, immediate),
        Work: authored(work, cell, typed),
        [tier]: observed(tier, cell, base, tier === "firm" ? firm.version : undefined),
      },
      units,
    );
    if (result.status !== "valid") throw new Error(`Invalid ducts criterion from ${result.source}`);
    return { ...result, version: result.version ?? versions?.[result.source] ?? null };
  };
  const criterion = <K extends Scalar>(key: K): Stated<DuctsCriteriaValues[K]> =>
    layered(work?.criteria?.[key] as DuctsCriteriaValues[K] | undefined, firm.criteria[key], key === "splitPolicy" ? null : key === "terminalDropInWg" ? "in-wg" : "in",
      run?.criteria?.[key] as DuctsCriteriaValues[K] | undefined, criteriaCellOf(key)!);
  // Each side resolves on its own: typing return keeps supply's source (ducts LEDGER, sided criteria).
  const side = (key: Sided, at: "supply" | "return") =>
    layered(work?.criteria?.[key]?.[at], firm.criteria[key][at], key === "velocityLimitFpm" ? "fpm" : "in-wg", run?.criteria?.[key]?.[at], criteriaCellOf(key, at)!);
  const sided = (key: Sided) => ({ supply: side(key, "supply"), return: side(key, "return") });
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
  ): Resolved<T> =>
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
  const store: StoreLayer = layers.snapshot.store ?? {};
  const slots: Slots = snapshot.slots;

  const criteria = resolveCriteria(work, firm, run, layers.versions);
  // A part's typed drop, else the drop its family was given (`component-drop:<family>`).
  const typedDropOf = (key: string, family: string | null | undefined): ValueCell<number> =>
    work.componentDrops?.[key]
      ? staged(work.componentDrops[key])
      : staged(family ? work.assumptions?.[`component-drop:${family}`] : undefined, (a) => a.inWg);

  const terminals: DuctsInputs["terminals"] = {};
  const units: DuctsInputs["units"] = {};
  const components: DuctsInputs["components"] = {};
  const placeholders = familyPlaceholders(snapshot);
  for (const n of snapshot.nodes) {
    const id = String(n.id), key = elementSubject(n);
    if (n.kind === "terminal") {
      const flow = WRITTEN.flows(n, slots, store);
      const cfm = pick(
        {
          run: staged(run.flows?.[key]),
          Work: staged(work.flows?.[key]),
          model: observed("model", `${id}/${flow.at}`, flow.live),
        },
        "cfm",
      );
      const dropCell = criteriaCellOf("terminalDropInWg")!;
      const tables = Object.fromEntries(
        Object.entries(work.catalogs ?? {}).flatMap(([k, c]) => ("value" in c ? [[k, { table: c.value }]] : [])),
      );
      const parameter = WRITTEN.terminalDrops(n, slots, store);
      // D2: a written parameter outranks the lookup, so the lookup runs only where Pe has not written.
      const catalog =
        parameter.wrote == null && catalogs && Object.keys(catalogs).length
          ? catalogLoss(n, cfm.value, catalogs, tables)
          : null;
      const model = observed("model", `${id}/${parameter.at}`, parameter.live);
      const served = firm.served?.terminalDropInWg ?? "firm";
      // Below Work, one of three (ADR 0053). Written: the parameter Pe wrote, missing when it no longer reads (D2, D3).
      // Catalog: the lookup, under its home's tier. Fallback: the parameter, over the criterion's base under the tier that served it.
      const catalogRung = catalog?.dp != null ? { [catalog.tier]: observed(catalog.tier, `${id}/${catalog.table}`, catalog.dp) } : null;
      const fallbackRung = { model, [served]: observed(served, dropCell, firm.criteria.terminalDropInWg, firm.version) };
      const drop = pick(
        {
          run: run.terminalDrops?.[key]
            ? staged(run.terminalDrops[key])
            : authored(run, dropCell, run.criteria?.terminalDropInWg),
          Work: work.terminalDrops?.[key]
            ? staged(work.terminalDrops[key])
            : authored(work, dropCell, work.criteria?.terminalDropInWg),
          ...(parameter.wrote != null ? { model } : (catalogRung ?? fallbackRung)),
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
          default: observed("default", `${id}/${suggestion.ref}`, suggestion.kind),
        },
        null,
        isKind,
      );
      const role = pick<"fan" | "passive">(
        {
          run: staged(run.roles?.[key]),
          Work: staged(work.roles?.[key]),
          "model-store": observed("model-store", `${id}/${STORE}`, store.roles?.[id]?.role as "fan" | "passive"),
          default: observed("default", `${id}/name`, suggestRole(n, kind.value ?? suggestion.kind)),
        },
        null,
        isRole,
      );
      // Revit categorizes inline heaters and silencers as equipment. They need a part drop,
      if (kind.value === "other" && role.value === "passive" && n.connectors.length === 2) {
        components[id] = {
          drop: pick(
            {
              run: staged(run.componentDrops?.[key]),
              Work: typedDropOf(key, n.family),
              model: observed("model", `${id}/${slots.componentDrop}`, positive(factOf(n, "pressureDrop"))),
            },
            "in-wg",
          ),
        };
        continue;
      }
      const flow = WRITTEN.equipmentFlows(n, slots, store);
      const cfm = pick(
        {
          run: staged(run.equipmentFlows?.[key]),
          Work: staged(work.equipmentFlows?.[key]),
          model: observed("model", `${id}/${flow.at}`, flow.live),
        },
        "cfm",
      );
      // P-030: ratedStatic comes only from the separate RatedEsp slot, below stated Work and run values.
      const esp = pick({ run: staged(run.ratedEsp?.[key]), Work: staged(work.ratedEsp?.[key]), model: observed("model", snapshot.slots.ratedEsp ?? "", snapshot.slots.ratedEsp ? factOf(n, "ratedStatic") : null) }, "in-wg");
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
      // The cells themselves gate the row: an unreadable one still resolves, as invalid (P-040).
      const typed = work.componentDrops?.[key];
      const familyCell = n.family ? work.assumptions?.[`component-drop:${n.family}`] : undefined;
      const family = familyCell && ("invalid" in familyCell || familyCell.value.inWg != null) ? familyCell : undefined;
      const stated = n.kind === "accessory" ? positive(factOf(n, "pressureDrop")) : null;
      const placeholder = placeholderOf(placeholders, n);
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
            model: observed("model", `${id}/${slots.componentDrop}`, placeholder ? null : stated),
          },
          "in-wg",
        );
        // The model states a value and it is refused as a family placeholder: the kernel's invalid, citing why,
        // never a missing value with a ref (P-041).
        components[id] = {
          drop:
            resolved.status === "missing" && placeholder
              ? { status: "invalid", value: null, source: "model", author: null, version: null, units: resolved.units,
                  ref: `family placeholder ${placeholder.inWg} on ${placeholder.count}` }
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
    if (value.status === "valid") tables[key] = value;
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
    if (value.status === "valid") assignments[family] = value;
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
    if (value.status === "valid") fittingDrops[key.slice(COMPONENT_DROP.length)] = value;
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

/** A resolved number as the contract's sourced value: the same kernel resolution, with an absent input read as missing. */
export const sourced = (r: Resolved<number> | undefined): SourcedValue<number> =>
  r ?? { status: "missing", value: null, source: "none", author: null, ref: null, version: null, units: null };

/** Encounter rulings use Work's network verdicts: connect accepts, ignore refuses. */
export function encounterRulings(layers: Pick<InputLayers, "run" | "work">): EncounterRuling[] {
  const [run, work] = [layers.run?.assumptions, layers.work?.assumptions];
  const verdict = (v: { verdict?: string }): EncounterRuling["verdict"] | null =>
    v.verdict === "connect" ? "accepted" : v.verdict === "ignore" ? "refused" : null;
  return Object.keys({ ...work, ...run }).flatMap((key): EncounterRuling[] => {
    const [elementId, connector] = key.startsWith("encounter:") ? key.slice(10).split(":").map(Number) : [];
    if (elementId == null || connector == null) return [];
    const at = { elementId, connector };
    if (!Number.isInteger(elementId) || !Number.isInteger(connector) || ENCOUNTER_KEY(at) !== key) return [];
    // P-029: a ruling is a staged value like any other, so one no known caller stamped is invalid and rules nothing.
    const r = resolveValue({ run: staged(run?.[key], verdict), Work: staged(work?.[key], verdict) });
    return r.status === "valid" && r.author && r.ref ? [{ at, verdict: r.value, by: r.author, ref: r.ref }] : [];
  });
}

const isKind = (v: string | undefined): v is DuctUnitKind =>
  DUCT_UNIT_KINDS.some((kind) => kind === v);
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
