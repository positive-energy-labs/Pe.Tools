/**
 * Duct pressure drop per terminal path, pure and deterministic: `ducts.snapshot` + ASHRAE grids +
 * staged table choices (+ typed overrides) in, rows out. Nothing is stored.
 * - A path runs from the group root (`topology.ts`) to one terminal and sums friction rows,
 *   fitting rows (C x Pv, rules in loss-rules.ts) and the terminal catalog total pressure.
 * - A tapped duct is split at each tap along its centerline: the part up to a tap carries the
 *   upstream flow; a tap the path passes charges Cs x Pv(main downstream); the tap the path leaves
 *   by charges Cb x Pv(branch) and ends the main friction there (handcalc.py).
 * - Flow at any element is the sum of the terminal design flows below it in the tree, which is
 *   what the snapshot pass-1 `flows` are; at a tap it is recomputed per leg.
 * - fan = the largest path total in a group; the critical terminal is its argmax.
 * - A path stepping across a proximity inference (`proximity.ts`) still prices; it names the
 *   finding ids its total rests on that no person confirmed (`inferred`), and is `provisional`
 *   only when one is `anomalous` (ruling 5, kaitpw 2026-10-20: a near miss and a stretched join are
 *   bridged and final; see `bins.ts`). A group's fan and the document's rest on every path under them.
 * - A group with no air mover (no root, or every root a `passive` unit) prices nothing:
 *   `byGroup[id].hasAirMover` is false and survey raises the blocking `no-fan` finding.
 * - A group several units root is walked from its largest fan's port (`unitCfm`, else the flow a
 *   fan serves in this group, `groupFans`); with several
 *   fans each prices its own section (`fan-sections.ts`) into `byGroup[id].fans`, and the group's
 *   `fan` and `critical` are the largest fan's.
 * Physics in loss-physics.ts, interpolation in loss-grid.ts, rule data in loss-rules.ts.
 */
import {
  catalogLoss,
  EMPTY_CATALOGS,
  type Catalogs,
  type CatalogFinding,
  type CatalogTable,
} from "./catalog.ts";
import type { DuctCalculation } from "@pe/agent-contracts";
import { designCircuits, type CircuitResult } from "./circuits.ts";
import {
  DEFAULT_DESIGN_FRICTION_RATE,
  rateOf,
  telOf,
  withEquivalentLength,
} from "./equivalent-length.ts";
import { transitionGeometry } from "./geometry.ts";
import { GridError, lookupGrid, type Grids } from "./loss-grid.ts";
import { friction, sectionOf } from "./loss-physics.ts";
import {
  LOSS_RULES,
  ruleByKey,
  type FittingFacts,
  type Flows,
  type Leg,
  type LossRule,
  type Port,
} from "./loss-rules.ts";
import type { DuctSnapshot } from "./types.ts";
import type { DuctInferenceGrade } from "@pe/agent-contracts";
import { byFlow, fanSections, groupFans, stretchOf, type FanSection } from "./fan-sections.ts";
import { worse, type InferredLink } from "./proximity.ts";
import { groupTree, pathTo, runsOf, terminalCfm, type GroupTree } from "./topology.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Node["connectors"][number];

type RowKind = "friction" | "fitting" | "tap-branch" | "tap-straight" | "terminal";

interface RowInputs {
  res: "Co" | "Cb" | "Cs";
  x: number;
  y?: number;
  xLabel: string;
  yLabel?: string;
  notes?: string[];
}

export interface Row {
  /** The element: the duct for friction (a tapped duct has several rows), else the fitting or terminal. */
  id: number;
  kind: RowKind;
  rule?: string;
  leg?: Leg | "ps";
  table?: string;
  c?: number;
  pv?: number;
  fpm?: number;
  dp: number | null;
  /** Friction rows: the straight length this row prices, ft. */
  lengthFt?: number;
  /** Friction rows: the duct's roughness, ft. */
  roughnessFt?: number;
  /** Friction rows: this duct's own actual friction rate, in-wg per 100 ft (dp / lengthFt x 100). */
  rate?: number;
  /** Effective length in feet at the rate of the duct this row sits on (`equivalent-length.ts`); null where unpriced. */
  eqFt?: number | null;
  source?: CatalogTable["source"];
  finding?: CatalogFinding;
  staticInWg?: number | null;
  /** The table lookup behind a fitting or tap row, structured so callers never parse `desc`. */
  inputs?: RowInputs;
  /** Revit's own reported drop for the fitting, shown beside dp; never an input. */
  revitDp?: number;
  desc: string;
  notes?: string[];
  error?: string;
}

interface LossError {
  id: number;
  rule?: string;
  table?: string;
  message: string;
}

/** Table name per rule key, upper case; absent keys use the rule default. */
export type Choices = Readonly<Record<string, string>>;

export interface Overrides {
  /** Design flow per terminal id, cfm; beats the snapshot's `flow` fact (survey: override > load preview > Revit). */
  terminalCfm?: Readonly<Record<number, number>>;
  /** Explicit manual drop per terminal id, in-wg. Native scalar drops do not attest a catalog total. */
  terminalPs?: Readonly<Record<number, number>>;
  catalogLinks?: Readonly<Record<string, { table: string }>>;
  /** A stated drop per fitting or accessory id, in-wg; replaces the rule lookup (not for taps). */
  componentDrop?: Readonly<Record<number, number>>;
  /** The role per air mover id (`unit-roles.ts`); a `passive` root is not an air mover. */
  unitRole?: Readonly<Record<number, "fan" | "passive">>;
  /** Design flow per air mover id, cfm (`equipmentFlows`): orders a group's fans, largest first. */
  unitCfm?: Readonly<Record<number, number>>;
  /** The design friction rate, in-wg per 100 ft: the rate a part with no duct on its path is read at. */
  designFrictionRate?: number;
}

interface PathLoss {
  groupId: string;
  total: number;
  /** Total effective length, ft: the straight duct plus every fitting and terminal as equivalent feet. */
  tel: number;
  rows: Row[];
  /** The proximity finding ids whose inferred joint or tap the path steps across, no person having confirmed them; its total rests on them. */
  inferred: string[];
  provisional: Provisional;
}

/**
 * A result resting on anomalous joins a person has not ruled on: their worst grade, how many, and
 * their finding ids. Null when final: every inference under it bridged (near miss, stretched) or confirmed.
 */
export type Provisional = null | {
  worst: DuctInferenceGrade;
  count: number;
  findingIds: string[];
};

interface RuleLoss {
  /** Rule dp on the critical path. */
  critical: number;
  /** Rule dp per terminal path. */
  per: Record<number, number>;
  /** Distinct fittings the rule priced. */
  instances: number;
}

export interface LossResult {
  design: CircuitResult;
  paths: Record<number, PathLoss>;
  /** Largest path total over every group, in-wg; 0 with no path. See `byGroup` for per-system fans. */
  fan: number;
  critical: number | null;
  /** The largest fan's standing: provisional when any path in any group is. */
  provisional: Provisional;
  byGroup: Record<
    string,
    {
      fan: number;
      critical: number | null;
      /** The critical path's total effective length, ft; null with no critical path. */
      criticalTel: number | null;
      revitCritical: number | null;
      /** Whether the group has an air mover (a root that is not staged passive); without one nothing is priced. */
      hasAirMover: boolean;
      /** The fan's standing: provisional when any path in the group is. */
      provisional: Provisional;
      /** One entry per fan when several fans root the group, largest design flow first; else empty. */
      fans: FanResult[];
    }
  >;
  byRule: Record<string, RuleLoss>;
  errors: LossError[];
}

/** One fan's section of a multi-fan group and what it prices to (`fan-sections.ts`). */
export interface FanResult extends FanSection {
  /** Its worst run's total, in-wg: the external static it must deliver. */
  esp: number;
  /** The terminal its worst run ends at; null with none. */
  critical: number | null;
  /** Its worst run's total effective length, ft. */
  tel: number | null;
  /** Its own stretch to the junction, priced at its design flow (empty for the largest fan). */
  stretch: Row[];
  /** Whether its worst run reaches the terminal through the junction, across a larger fan's section. */
  viaJunction: boolean;
}

const LEG_KIND = { C: "fitting", Cb: "tap-branch", Cs: "tap-straight" } as const;

const factOf = (node: Node, key: string) => node.facts.find((f) => f.key === key)?.value ?? null;

const portOf = (c: Connector | undefined): Port | null =>
  c
    ? {
        shape: c.shape,
        section: sectionOf(c.shape, c.diameterIn, c.widthIn, c.heightIn),
        widthIn: c.widthIn,
        heightIn: c.heightIn,
      }
    : null;

const segmentSection = (s: Segment) => sectionOf(s.shape, s.diameterIn, s.widthIn, s.heightIn);

const isTap = (node: Node | null | undefined) =>
  !!node && (node.partType?.startsWith("Tap") === true || factOf(node, "takeoff") === 1);

/**
 * Facts the rules read, from a node connectors and W1 facts. `prev` is the element toward the
 * root, `next` the one toward the terminal on this path (null for a tap passed straight), `parent`
 * the duct a tap hangs off.
 */
function fittingFacts(
  node: Node,
  prev: number | null,
  next: number | null,
  parent: Segment | null = null,
  root: GroupTree["root"] = null,
): FittingFacts {
  const toward = (id: number | null) =>
    node.connectors.find((c) => id != null && c.connectedTo?.elementId === id);
  const tap = isTap(node);
  const main = toward(prev);
  // W1 `inlet` is the connector index facing the root; derive from the path only when absent.
  const stated = factOf(node, "inlet");
  const facing = stated == null ? undefined : node.connectors.find((c) => c.index === stated);
  const attached = prev == null && root?.element === node.id && root.equipment != null;
  // A root-attached fitting has no preceding path element. Its inlet is the exact equipment
  // connector held by the tree, including the port index; an absent match stays unknown.
  const walkedInlet = attached
    ? node.connectors.find(
        (c) => c.connectedTo?.elementId === root.equipment && c.connectedTo.connector === root.port,
      )
    : (facing ?? (tap ? node.connectors.find((c) => c !== main) : (main ?? node.connectors[0])));
  const walkedOutlet = tap
    ? undefined
    : (toward(next) ??
      node.connectors.find((c) => c !== walkedInlet && c.connectedTo?.elementId !== prev));
  const transition = node.partType === "Transition";
  const physical = transition ? transitionGeometry(node) : null;
  // Connectors that are not one In and one Out (bidirectional on Chadds) take the tree walk's direction.
  const walked = physical != null && physical.inlet == null;
  const inlet = physical?.inlet ?? walkedInlet;
  const outlet = physical?.outlet ?? walkedOutlet;
  const inletPort = portOf(inlet) ?? { shape: "other", section: null };
  const outletPort = portOf(outlet);
  const ratio =
    inletPort.section && outletPort?.section
      ? outletPort.section.areaFt2 / inletPort.section.areaFt2
      : null;
  // A tap collar connector is the branch size; the main is the duct it hangs off.
  const mainArea = factOf(node, "mainArea");
  const mainPort: Port | null = !tap
    ? null
    : mainArea != null
      ? {
          shape: "round",
          section: { areaFt2: mainArea, dhIn: 12 * Math.sqrt((4 * mainArea) / Math.PI) },
        }
      : parent
        ? { shape: parent.shape, section: segmentSection(parent) }
        : null;
  return {
    kind: node.kind === "accessory" ? "accessory" : "fitting",
    family: node.family ?? null,
    partType: node.partType ?? null,
    rOverD: factOf(node, "rOverD"),
    aoOverA1: transition ? ratio : (factOf(node, "aoOverA1") ?? ratio),
    angleDeg: physical ? physical.angleDeg : factOf(node, "angle"),
    ...(walked ? { note: "oriented by the tree walk; its connectors state no In/Out pair" } : {}),
    inputError: physical?.error,
    inlet: inletPort,
    outlet: outletPort,
    main: mainPort,
    abOverAc: factOf(node, "abOverAc"),
    takeoff: tap,
  };
}

const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));

/** Distance of a tap from the upstream end of its duct, ft, along the centerline. */
function tapDistance(
  duct: Segment,
  tap: Node,
  parentId: number | null,
  root: GroupTree["root"],
): number {
  const poly = duct.polyline;
  const legs = poly.slice(1).map((p, i) => dist(p, poly[i]!));
  const total = legs.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  const curve = duct.connectors.find((c) => c.connectedTo?.elementId === tap.id);
  const at = curve?.point ?? tap.point;
  let best = { d: Infinity, s: 0 };
  let run = 0;
  poly.slice(1).forEach((b, i) => {
    const a = poly[i]!;
    const ab = b.map((v, k) => v - a[k]!);
    const len2 = ab.reduce((s, v) => s + v * v, 0);
    const dot = ab.reduce((s, v, k) => s + v * (at[k]! - a[k]!), 0);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot / len2));
    const d = dist(
      a.map((v, k) => v + ab[k]! * t),
      at,
    );
    if (d < best.d) best = { d, s: run + t * legs[i]! };
    run += legs[i]!;
  });
  // The curve's stored direction does not establish the equipment end of a root duct.
  const attached = parentId == null && root?.element === duct.id && root.equipment != null;
  const up = duct.connectors.find(
    (c) =>
      c.kind !== "curve" &&
      (attached
        ? c.connectedTo?.elementId === root.equipment && c.connectedTo.connector === root.port
        : parentId != null && c.connectedTo?.elementId === parentId),
  );
  const fromEnd = up != null && dist(up.point, poly.at(-1)!) < dist(up.point, poly[0]!);
  const s = fromEnd ? total - best.s : best.s;
  return Math.max(0, Math.min(duct.lengthFt, (s / total) * duct.lengthFt));
}

type System = NonNullable<DuctSnapshot["systems"]>[number];

/** Revit's system that carries a terminal: the one whose sections list it. */
export const systemFor = (snapshot: DuctSnapshot, terminalId: number): System | undefined =>
  snapshot.systems?.find((sys) =>
    sys.sections.some((section) => section.elementIds.includes(terminalId)),
  );

const round4 = (n: number) => +n.toFixed(4);

/** Compute every terminal path of every group. */
export function computeLosses(
  snapshot: DuctSnapshot,
  grids: Grids,
  choices: Choices = {},
  overrides: Overrides = {},
  evidence: Readonly<Record<string, DuctCalculation>> = {},
  catalogs: Catalogs = EMPTY_CATALOGS,
  inferred: readonly InferredLink[] = [],
): LossResult {
  const byPair = new Map<string, string[]>();
  const gradeOf = new Map<string, DuctInferenceGrade>();
  for (const { id, between, grade, ruled } of inferred) {
    // A person's confirmation clears the inference; the path no longer rests on it.
    if (ruled) continue;
    gradeOf.set(id, grade);
    const pair = [...between].sort((a, b) => a - b).join("|");
    byPair.set(pair, [...(byPair.get(pair) ?? []), id]);
  }
  const provisionalOf = (ids: Iterable<string>): Provisional => {
    const open = [...new Set(ids)].filter((id) => gradeOf.get(id) === "anomalous").sort();
    return open.length
      ? {
          worst: open.map((id) => gradeOf.get(id)!).reduce(worse),
          count: open.length,
          findingIds: open,
        }
      : null;
  };
  const restsOn = (path: number[]) => [
    ...new Set(
      path.flatMap((id, k) =>
        k ? (byPair.get([path[k - 1]!, id].sort((a, b) => a - b).join("|")) ?? []) : [],
      ),
    ),
  ];
  const result = {
    paths: {},
    fan: 0,
    critical: null,
    provisional: null,
    byGroup: {},
    byRule: {},
    errors: [],
  } as Omit<LossResult, "design">;
  const seen = new Set<string>();
  const priced = new Map<string, Set<number>>();
  const fail = (e: LossError) => {
    const key = `${e.id}|${e.rule}|${e.table}|${e.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.errors.push(e);
    }
    return e.message;
  };

  const everywhere: string[] = [];
  let nodes: Map<number, Node> | null = null;
  const nodeById = () => (nodes ??= new Map(snapshot.nodes.map((n) => [n.id, n])));
  for (const group of snapshot.groups) {
    // A fan states no flow: it reads the sum of the grilles it serves in this group, never another's.
    const fans = byFlow(
      groupFans(
        () => groupTree(snapshot, group.id),
        group.rootIds.filter((id) => overrides.unitRole?.[id] !== "passive"),
        (unit) => overrides.unitCfm?.[unit],
        (t) => overrides.terminalCfm?.[t] ?? terminalCfm(nodeById().get(t)) ?? 0,
      ).map(({ unit, cfm }) => ({ unit, cfm })),
    );
    // Several units: walk from the largest fan's port, never from a passive unit's.
    const lead = group.rootIds.length > 1 ? fans[0]?.unit : undefined;
    const tree = groupTree(snapshot, group.id, lead);
    const below = flowBelow(tree, overrides);
    const sections = fans.length > 1 ? fanSections(tree, fans) : [];
    const others = new Set(sections.slice(1).flatMap((s) => s.owned));
    const runPaths = new Map<number, number[]>();
    let fan = 0;
    let critical: number | null = null;
    const under: string[] = [];
    const hasAirMover = fans.length > 0;
    // No air mover: no path to price (never from the open end); survey says so as a `no-fan` finding.
    for (const run of hasAirMover ? runsOf(tree) : []) {
      // A terminal a smaller fan's section holds is priced from that fan (below).
      if (others.has(run.terminal)) continue;
      runPaths.set(run.terminal, run.path);
      const rows = pathRows(tree, run.path, below, grids, choices, overrides, fail, catalogs);
      const total = rows.reduce((a, r) => a + (r.dp ?? 0), 0);
      const rests = restsOn(run.path);
      result.paths[run.terminal] = {
        groupId: group.id,
        total,
        tel: telOf(rows),
        rows,
        inferred: rests,
        provisional: provisionalOf(rests),
      };
      under.push(...rests);
      if (critical == null || total > fan || (total === fan && run.terminal < critical)) {
        fan = total;
        critical = run.terminal;
      }
      for (const r of rows)
        if (r.rule) {
          if (!priced.has(r.rule)) priced.set(r.rule, new Set());
          priced.get(r.rule)!.add(r.id);
        }
    }
    const fanResults = sections.map((section, k): FanResult => {
      if (k === 0) {
        const tel = critical == null ? null : (result.paths[critical]?.tel ?? null);
        return { ...section, esp: fan, critical, tel, stretch: [], viaJunction: false };
      }
      const own = groupTree(snapshot, group.id, section.unit);
      const stretch = stretchOf(tree, section);
      const ownBelow = flowBelow(own, overrides);
      for (const id of stretch) ownBelow.set(id, section.cfm ?? 0);
      const price = (path: number[]) =>
        pathRows(own, path, ownBelow, grids, choices, overrides, fail, catalogs);
      const stretchRows = stretch.length ? price(stretch) : [];
      let best: { total: number; terminal: number; tel: number; via: boolean } | null = null;
      const consider = (total: number, terminal: number, tel: number, via: boolean) => {
        if (!best || total > best.total || (total === best.total && terminal < best.terminal))
          best = { total, terminal, tel, via };
      };
      // Its own runs: terminals past its port.
      for (const t of section.owned.filter((id) => tree.parts.get(id)?.node?.kind === "terminal")) {
        if (own.root == null || pathTo(own.parent, t)[0] !== own.root.element) continue;
        const path = pathTo(own.parent, t);
        const rows = price(path);
        const total = rows.reduce((a, r) => a + (r.dp ?? 0), 0);
        const rests = restsOn(path);
        under.push(...rests);
        result.paths[t] = {
          groupId: group.id,
          total,
          tel: telOf(rows),
          rows,
          inferred: rests,
          provisional: provisionalOf(rests),
        };
        consider(total, t, telOf(rows), false);
      }
      // Through the junction: its stretch, then the larger section's run from the junction on.
      const stretchDp = stretchRows.reduce((a, r) => a + (r.dp ?? 0), 0);
      for (const [t, path] of runPaths) {
        const at = section.junction == null ? -1 : path.indexOf(section.junction);
        if (at < 0) continue;
        const onward = new Set(path.slice(at));
        const rows = result.paths[t]!.rows;
        const from = rows.findIndex((r) => onward.has(r.id));
        if (from < 0) continue;
        const tail = rows.slice(from);
        consider(
          stretchDp + tail.reduce((a, r) => a + (r.dp ?? 0), 0),
          t,
          telOf(stretchRows) + telOf(tail),
          true,
        );
      }
      const worst = best as { total: number; terminal: number; tel: number; via: boolean } | null;
      return {
        ...section,
        esp: worst?.total ?? stretchDp,
        critical: worst?.terminal ?? null,
        tel: worst?.tel ?? (stretch.length ? telOf(stretchRows) : null),
        stretch: stretchRows,
        viaJunction: worst?.via ?? false,
      };
    });
    result.byGroup[group.id] = {
      fans: fanResults,
      fan,
      critical,
      criticalTel: critical == null ? null : (result.paths[critical]?.tel ?? null),
      revitCritical:
        (critical == null ? null : systemFor(snapshot, critical)?.criticalPathLossInWg) ?? null,
      hasAirMover,
      provisional: provisionalOf(under),
    };
    everywhere.push(...under);
    if (critical != null && (result.critical == null || fan > result.fan)) {
      result.fan = fan;
      result.critical = critical;
    }
  }

  result.provisional = provisionalOf(everywhere);
  const ruleDp = (rows: Row[], key: string) =>
    rows.filter((r) => r.rule === key).reduce((a, r) => a + (r.dp ?? 0), 0);
  for (const rule of LOSS_RULES)
    result.byRule[rule.key] = {
      critical: result.critical == null ? 0 : ruleDp(result.paths[result.critical]!.rows, rule.key),
      per: Object.fromEntries(
        Object.entries(result.paths).map(([t, p]) => [t, ruleDp(p.rows, rule.key)]),
      ),
      instances: priced.get(rule.key)?.size ?? 0,
    };
  const design = designCircuits(snapshot, evidence, overrides, (tree, below, circuitOverrides) =>
    runsOf(tree).map((run) => {
      const rows = pathRows(
        tree,
        run.path,
        below,
        grids,
        choices,
        circuitOverrides,
        (e) => e.message,
        catalogs,
      );
      return { terminalId: run.terminal, rows, total: rows.reduce((a, r) => a + (r.dp ?? 0), 0) };
    }),
  );
  return { ...result, design };
}

/** Terminal design flow summed over every element subtree, cfm. */
function flowBelow(tree: GroupTree, overrides: Overrides): Map<number, number> {
  const below = new Map<number, number>();
  const visit = (id: number): number => {
    const node = tree.parts.get(id)!.node;
    const own =
      node?.kind === "terminal" ? (overrides.terminalCfm?.[id] ?? terminalCfm(node) ?? 0) : 0;
    const sum = tree.children.get(id)!.reduce((a, c) => a + visit(c), own);
    below.set(id, sum);
    return sum;
  };
  for (const id of tree.order) if (tree.parent.get(id) === null) visit(id);
  return below;
}

function pathRows(
  tree: GroupTree,
  path: number[],
  below: Map<number, number>,
  grids: Grids,
  choices: Choices,
  overrides: Overrides,
  fail: (e: LossError) => string,
  catalogs: Catalogs,
): Row[] {
  const rows: Row[] = [];
  /** Main flow upstream of the tap the path leaves by, recorded while its duct is walked. */
  const mainFlowAt = new Map<number, number>();

  const ruleRow = (
    node: Node,
    rule: LossRule,
    facts: FittingFacts,
    flows: Flows,
    leg: Leg,
  ): Row => {
    const table = (choices[rule.key] ?? rule.table).toUpperCase();
    const base = { id: node.id, kind: LEG_KIND[leg], rule: rule.key, leg, table } as const;
    const bad = (message: string): Row => {
      fail({ id: node.id, rule: rule.key, table, message });
      return {
        ...base,
        dp: 0,
        desc: `${rule.family} ${node.id}, ${table}: ${message}`,
        error: message,
      };
    };
    const input = rule.input(facts, flows, table, leg);
    const grid = grids[table]?.[input.res];
    if (!grid) return bad(`${table} ${input.res} is not loaded`);
    let found;
    try {
      found = lookupGrid(grid, input.x, input.y);
    } catch (e) {
      if (e instanceof GridError) return bad(e.message);
      throw e;
    }
    const basis = rule.basisOf(facts, flows, leg);
    if (!basis.section) return bad("no cross-section for the velocity pressure");
    const f = friction(basis.section, basis.cfm, 0);
    return {
      ...base,
      c: found.value,
      pv: f.pv,
      fpm: f.fpm,
      dp: found.value * f.pv,
      inputs: {
        res: input.res as RowInputs["res"],
        x: input.x,
        ...(input.y == null ? {} : { y: input.y }),
        xLabel: grid.xLabel,
        ...(grid.yLabel ? { yLabel: grid.yLabel } : {}),
        ...(found.notes.length ? { notes: found.notes } : {}),
      },
      desc: `${rule.family} ${node.id}, ${table} ${input.res} ${round4(found.value)} x Pv ${Math.round(f.fpm)} fpm (${found.inputs})`,
      ...(found.notes.length || facts.note
        ? { notes: [...found.notes, ...(facts.note ? [facts.note] : [])] }
        : {}),
    };
  };

  const fitting = (
    node: Node,
    prev: number | null,
    next: number | null,
    flows: Flows,
    leg: Leg,
  ) => {
    const parentPart = prev == null ? null : tree.parts.get(prev);
    const facts = fittingFacts(node, prev, next, parentPart?.segment ?? null, tree.root);
    const stated = overrides.componentDrop?.[node.id];
    if (stated != null && !facts.takeoff) {
      rows.push({
        id: node.id,
        kind: "fitting",
        dp: stated,
        desc: `${node.partType ?? node.kind} ${node.id}, stated drop`,
      });
      return;
    }
    const inputError = facts.inputError;
    if (inputError) {
      fail({ id: node.id, message: inputError });
      rows.push({
        id: node.id,
        kind: LEG_KIND[leg],
        dp: 0,
        desc: `${node.id}: ${inputError}`,
        error: inputError,
      });
      return;
    }
    const rule = LOSS_RULES.find((r) => r.when(facts, flows));
    if (!rule) {
      if (facts.takeoff) return; // a tap with no branch flow loses nothing here
      const message = fail({
        id: node.id,
        message: `no rule matches ${node.partType ?? node.kind} ${node.id}`,
      });
      rows.push({ id: node.id, kind: LEG_KIND[leg], dp: 0, desc: message, error: message });
      return;
    }
    rows.push(ruleRow(node, rule, facts, flows, leg));
  };

  const terminalRow = (node: Node) => {
    const cfm = overrides.terminalCfm?.[node.id] ?? terminalCfm(node);
    const manual = overrides.terminalPs?.[node.id];
    if (manual != null) {
      rows.push({
        id: node.id,
        kind: "terminal",
        leg: "ps",
        dp: manual,
        desc: `terminal ${node.id}, manual pressure override`,
      });
      return;
    }
    const loss = catalogLoss(node, cfm, catalogs, overrides.catalogLinks);
    // No catalog link: the drop the model holds (named catalog parameter, then assigned connector loss).
    // A connector whose loss method is NotDefined holds a 0 that states nothing: it is no drop, not a zero drop.
    const assigned = node.terminalDrop?.connectorLossMethod?.endsWith("NotDefined")
      ? null
      : node.terminalDrop?.assignedPressureDropInWg;
    const held = node.terminalDrop?.catalogDropInWg ?? assigned;
    if (loss.dp === null && loss.finding === "catalog-missing-link" && held != null) {
      rows.push({
        id: node.id,
        kind: "terminal",
        leg: "ps",
        dp: held,
        desc: `terminal ${node.id} at ${cfm ?? "?"} cfm, terminal drop`,
      });
      return;
    }
    if (loss.dp === null) fail({ id: node.id, table: loss.table, message: loss.error });
    rows.push({
      id: node.id,
      kind: "terminal",
      ...loss,
      desc: `terminal ${node.id} at ${cfm ?? "?"} cfm, catalog total pressure`,
    });
  };

  const ductRows = (duct: Segment, prev: number | null, next: number | null) => {
    const section = segmentSection(duct);
    const label = duct.kind === "flex" ? "flex" : "duct";
    if (!section) {
      const message = fail({
        id: duct.id,
        message: `${duct.kind} ${duct.id} (${duct.size}) has no section Pe can use`,
      });
      rows.push({ id: duct.id, kind: "friction", dp: 0, desc: message, error: message });
      return;
    }
    const run = (seg: number, cfm: number) => {
      if (seg <= 1e-9) return;
      const f = friction(section, cfm, seg, duct.roughness.valueFt);
      rows.push({
        id: duct.id,
        kind: "friction",
        pv: f.pv,
        fpm: f.fpm,
        dp: f.dp,
        lengthFt: seg,
        roughnessFt: duct.roughness.valueFt,
        ...(rateOf(f.dp, seg) == null ? {} : { rate: rateOf(f.dp, seg)! }),
        desc: `${label} ${duct.size}, ${seg.toFixed(3)} ft at ${Math.round(cfm)} cfm, f ${f.f.toFixed(5)}`,
      });
    };
    // Taps on this duct, ordered along it from the end facing the root.
    const taps = (tree.children.get(duct.id) ?? [])
      .map((id) => tree.parts.get(id)!.node)
      .filter((n): n is Node => isTap(n))
      .map((n) => ({
        node: n,
        pos: tapDistance(duct, n, prev, tree.root),
        qb: below.get(n.id) ?? 0,
      }))
      .sort((a, b) => a.pos - b.pos || a.node.id - b.node.id);
    let q = below.get(duct.id) ?? 0;
    let at = 0;
    for (const tap of taps) {
      run(tap.pos - at, q);
      at = tap.pos;
      if (tap.node.id === next) {
        mainFlowAt.set(tap.node.id, q);
        return;
      }
      if (tap.qb > 0) {
        fitting(tap.node, duct.id, null, { q, qb: tap.qb, qc: q, qs: q - tap.qb }, "Cs");
        q -= tap.qb;
      }
    }
    run(duct.lengthFt - at, q);
  };

  path.forEach((id, k) => {
    const prev = k > 0 ? path[k - 1]! : null;
    const next = path[k + 1] ?? null;
    const part = tree.parts.get(id)!;
    if (part.segment) return ductRows(part.segment, prev, next);
    const node = part.node!;
    if (node.kind === "terminal") return terminalRow(node);
    if (node.kind === "equipment" && overrides.componentDrop?.[id] != null) {
      rows.push({
        id,
        kind: "fitting",
        dp: overrides.componentDrop[id]!,
        desc: `passive equipment ${id}, sourced design-point drop`,
      });
      return;
    }
    if (node.kind !== "fitting" && node.kind !== "accessory") return;
    if (isTap(node)) {
      const qb = below.get(node.id) ?? 0;
      const fromMain = prev != null && prev === factOf(node, "mainSegment");
      // Entered from the collar (Chadds: the last run to a grille, fed through the tap's side into
      // a duct capped at its far end), all of the air turns through it: its branch leg at Qb/Qc = 1.
      if (!fromMain && qb > 0) {
        const facts = fittingFacts(
          node,
          prev,
          next,
          tree.parts.get(prev!)?.segment ?? null,
          tree.root,
        );
        const rule = ruleByKey("tap-std")!;
        return void rows.push(
          ruleRow(
            node,
            rule,
            { ...facts, note: "entered from the collar: priced as its branch turn at Qb/Qc = 1" },
            { q: qb, qb, qc: qb, qs: 0 },
            "Cb",
          ),
        );
      }
      const qc = fromMain ? mainFlowAt.get(node.id) : null;
      if (qc == null) {
        const message = fail({
          id: node.id,
          message: `tap ${node.id} carries no branch flow or its main flow is unknown, no takeoff rule applies`,
        });
        return void rows.push({
          id: node.id,
          kind: LEG_KIND.Cb,
          dp: 0,
          desc: message,
          error: message,
        });
      }
      return fitting(node, prev, next, { q: qb, qb, qc, qs: qc - qb }, "Cb");
    }
    fitting(node, prev, next, { q: below.get(node.id) ?? 0 }, "C");
  });
  return withEquivalentLength(rows, overrides.designFrictionRate ?? DEFAULT_DESIGN_FRICTION_RATE);
}

export interface Fanout {
  before: LossResult;
  after: LossResult;
  /** Terminals whose path total moved. */
  movedTerminals: number[];
  /** Distinct fittings the rule prices, which the new table rewrites. */
  instances: number;
}

/** What staging `newTable` under `ruleKey` would move, before it lands; `before` is the solve at `choices`/`overrides` when the caller holds it. */
export function fanout(
  snapshot: DuctSnapshot,
  grids: Grids,
  choices: Choices,
  ruleKey: string,
  newTable: string,
  overrides: Overrides = {},
  before?: LossResult,
  catalogs: Catalogs = EMPTY_CATALOGS,
): Fanout {
  before ??= computeLosses(snapshot, grids, choices, overrides, {}, catalogs);
  const rule = ruleByKey(ruleKey);
  if (!rule) throw new Error(`no loss rule ${ruleKey}`);
  const table = newTable.toUpperCase();
  if (!rule.options.includes(table)) throw new Error(`${table} is not a candidate for ${ruleKey}`);
  const after = computeLosses(
    snapshot,
    grids,
    { ...choices, [ruleKey]: table },
    overrides,
    {},
    catalogs,
  );
  const movedTerminals = Object.keys(after.paths)
    .map(Number)
    .filter((t) => Math.abs(after.paths[t]!.total - (before.paths[t]?.total ?? NaN)) > 1e-9);
  return { before, after, movedTerminals, instances: after.byRule[ruleKey]!.instances };
}
