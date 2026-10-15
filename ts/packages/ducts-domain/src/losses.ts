/**
 * Duct pressure drop per terminal path, pure and deterministic: `ducts.snapshot` + ASHRAE grids +
 * staged table choices (+ typed overrides) in, rows out. Nothing is stored.
 * - A path runs from the group root (`topology.ts`) to one terminal and sums friction rows,
 *   fitting rows (C x Pv, rules in loss-rules.ts) and the terminal catalog static pressure.
 * - A tapped duct is split at each tap along its centerline: the part up to a tap carries the
 *   upstream flow; a tap the path passes charges Cs x Pv(main downstream); the tap the path leaves
 *   by charges Cb x Pv(branch) and ends the main friction there (handcalc.py).
 * - Flow at any element is the sum of the terminal design flows below it in the tree, which is
 *   what the snapshot pass-1 `flows` are; at a tap it is recomputed per leg.
 * - fan = the largest path total in a group; the critical terminal is its argmax.
 * Physics in loss-physics.ts, interpolation in loss-grid.ts, rule data in loss-rules.ts.
 */
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
import { groupTree, runsOf, terminalCfm, type GroupTree } from "./topology.ts";

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
  dp: number;
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
  /** Catalog static pressure per terminal id, in-wg; beats `terminalDrop.catalogDropInWg`, then `assignedPressureDropInWg`. */
  terminalPs?: Readonly<Record<number, number>>;
  /** A stated drop per fitting or accessory id, in-wg; replaces the rule lookup (not for taps). */
  componentDrop?: Readonly<Record<number, number>>;
}

interface PathLoss {
  groupId: string;
  total: number;
  rows: Row[];
}

interface RuleLoss {
  /** Rule dp on the critical path. */
  critical: number;
  /** Rule dp per terminal path. */
  per: Record<number, number>;
  /** Distinct fittings the rule priced. */
  instances: number;
}

export interface LossResult {
  paths: Record<number, PathLoss>;
  /** Largest path total over every group, in-wg; 0 with no path. See `byGroup` for per-system fans. */
  fan: number;
  critical: number | null;
  byGroup: Record<string, { fan: number; critical: number | null; revitCritical: number | null }>;
  byRule: Record<string, RuleLoss>;
  errors: LossError[];
}

const LEG_KIND = { C: "fitting", Cb: "tap-branch", Cs: "tap-straight" } as const;

const factOf = (node: Node, key: string) => node.facts.find((f) => f.key === key)?.value ?? null;

const portOf = (c: Connector | undefined): Port | null =>
  c ? { shape: c.shape, section: sectionOf(c.shape, c.diameterIn, c.widthIn, c.heightIn) } : null;

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
  const inlet = attached
    ? node.connectors.find(
        (c) => c.connectedTo?.elementId === root.equipment && c.connectedTo.connector === root.port,
      )
    : (facing ?? (tap ? node.connectors.find((c) => c !== main) : (main ?? node.connectors[0])));
  const outlet = tap
    ? undefined
    : (toward(next) ??
      node.connectors.find((c) => c !== inlet && c.connectedTo?.elementId !== prev));
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
    partType: node.partType ?? null,
    rOverD: factOf(node, "rOverD"),
    aoOverA1: factOf(node, "aoOverA1") ?? ratio,
    inlet: inletPort,
    outlet: outletPort,
    main: mainPort,
    abOverAc: factOf(node, "abOverAc"),
    takeoff: tap,
  };
}

const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));

/** Distance of a tap from the upstream end of its duct, ft, along the centerline. */
function tapDistance(duct: Segment, tap: Node, parentId: number | null): number {
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
  // Measure from the end that faces the parent; a root duct measures from the polyline start.
  const up = duct.connectors.find(
    (c) => c.kind !== "curve" && parentId != null && c.connectedTo?.elementId === parentId,
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
): LossResult {
  const result: LossResult = {
    paths: {},
    fan: 0,
    critical: null,
    byGroup: {},
    byRule: {},
    errors: [],
  };
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

  for (const group of snapshot.groups) {
    const tree = groupTree(snapshot, group.id);
    const below = flowBelow(tree);
    let fan = 0;
    let critical: number | null = null;
    for (const run of runsOf(tree)) {
      const rows = pathRows(tree, run.path, below, grids, choices, overrides, fail);
      const total = rows.reduce((a, r) => a + r.dp, 0);
      result.paths[run.terminal] = { groupId: group.id, total, rows };
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
    result.byGroup[group.id] = {
      fan,
      critical,
      revitCritical:
        (critical == null ? null : systemFor(snapshot, critical)?.criticalPathLossInWg) ?? null,
    };
    if (critical != null && (result.critical == null || fan > result.fan)) {
      result.fan = fan;
      result.critical = critical;
    }
  }

  const ruleDp = (rows: Row[], key: string) =>
    rows.filter((r) => r.rule === key).reduce((a, r) => a + r.dp, 0);
  for (const rule of LOSS_RULES)
    result.byRule[rule.key] = {
      critical: result.critical == null ? 0 : ruleDp(result.paths[result.critical]!.rows, rule.key),
      per: Object.fromEntries(
        Object.entries(result.paths).map(([t, p]) => [t, ruleDp(p.rows, rule.key)]),
      ),
      instances: priced.get(rule.key)?.size ?? 0,
    };
  return result;
}

/** Terminal design flow summed over every element subtree, cfm. */
function flowBelow(tree: GroupTree): Map<number, number> {
  const below = new Map<number, number>();
  const visit = (id: number): number => {
    const node = tree.parts.get(id)!.node;
    const own = node?.kind === "terminal" ? (terminalCfm(node) ?? 0) : 0;
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
      ...(found.notes.length ? { notes: found.notes } : {}),
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
    const drop = node.terminalDrop;
    const ps =
      overrides.terminalPs?.[node.id] ?? drop?.catalogDropInWg ?? drop?.assignedPressureDropInWg;
    const cfm = terminalCfm(node);
    let error: string | undefined;
    if (ps == null)
      error = fail({ id: node.id, message: `terminal ${node.id} has no terminal drop` });
    else if (cfm == null)
      error = fail({ id: node.id, message: `terminal ${node.id} has no design flow` });
    rows.push({
      id: node.id,
      kind: "terminal",
      leg: "ps",
      dp: ps ?? 0,
      desc: `terminal ${node.id} at ${cfm ?? "?"} cfm, terminal drop`,
      ...(error ? { error } : {}),
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
        desc: `${label} ${duct.size}, ${seg.toFixed(3)} ft at ${Math.round(cfm)} cfm, f ${f.f.toFixed(5)}`,
      });
    };
    // Taps on this duct, ordered along it from the end facing the root.
    const taps = (tree.children.get(duct.id) ?? [])
      .map((id) => tree.parts.get(id)!.node)
      .filter((n): n is Node => isTap(n))
      .map((n) => ({ node: n, pos: tapDistance(duct, n, prev), qb: below.get(n.id) ?? 0 }))
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
    if (node.kind !== "fitting" && node.kind !== "accessory") return;
    if (isTap(node)) {
      const qb = below.get(node.id) ?? 0;
      // A takeoff is priced only when the path enters it from its main duct.
      const qc =
        prev != null && prev === factOf(node, "mainSegment") ? mainFlowAt.get(node.id) : null;
      if (qc == null) {
        const message = fail({
          id: node.id,
          message: `tap ${node.id} is entered from the collar or has no main segment, no takeoff rule applies`,
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
  return rows;
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
  before: LossResult = computeLosses(snapshot, grids, choices, overrides),
): Fanout {
  const rule = ruleByKey(ruleKey);
  if (!rule) throw new Error(`no loss rule ${ruleKey}`);
  const table = newTable.toUpperCase();
  if (!rule.options.includes(table)) throw new Error(`${table} is not a candidate for ${ruleKey}`);
  const after = computeLosses(snapshot, grids, { ...choices, [ruleKey]: table }, overrides);
  const movedTerminals = Object.keys(after.paths)
    .map(Number)
    .filter((t) => Math.abs(after.paths[t]!.total - (before.paths[t]?.total ?? NaN)) > 1e-9);
  return { before, after, movedTerminals, instances: after.byRule[ruleKey]!.instances };
}
