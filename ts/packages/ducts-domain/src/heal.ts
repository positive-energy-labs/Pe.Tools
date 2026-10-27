/** Heal proposals only; the native op re-checks and post-checks. Model feet, limits inches. */
import type { DuctFinding, DuctsRouteDocument } from "@pe/agent-contracts";
import { tolerate, topologyRulingsKey, verdictOf } from "./proximity.ts";
import { subjectName } from "./words.ts";
import { withStoredRulings } from "./rulings.ts";
import type { DuctSnapshot } from "./types.ts";

/** An open end with no same-class open end this close is dangling and takes a cap (ruling 2026-10-20). */
export const HEAL_DANGLING_IN = 60;
/** Ends this close are coincident: ConnectTo alone. Mirrors DuctHealer.CoincidentIn. */
export const HEAL_COINCIDENT_IN = 1 / 16;
/**
 * The widest gap healed by a union or an extend. The spike PROVED a 3 in union and a 2.8 in extend
 * and FALSIFIED a 13.7 in extend; kept at the proven 3 in. Mirrors DuctHealer.JoinGapIn.
 */
export const HEAL_JOIN_GAP_IN = 3;
/** The most an end may sit off its partner's axis to be bridged. Mirrors DuctHealer.CheckTolIn. */
export const HEAL_LATERAL_IN = 1 / 16;
const OPPOSED_COS = 0.999;
const SIZE_TOL_IN = 0.01;

export type HealHow = "cap" | "connect" | "union" | "extend";
export interface HealItem {
  /** `cap:<end>` or `join:<a>|<b>`; the native op's item key. */
  key: string;
  kind: "cap" | "join";
  how: HealHow;
  /** Connector keys `elementId:connectorIndex`, as `ducts.snapshot` names them. */
  end: string;
  other?: string;
  gapIn: number;
  ids: number[];
  /** The finding ids this item answers: the open-end issues it closes and the proximity join it makes real. */
  covers: string[];
}
export interface HealGroup {
  group: string;
  items: HealItem[];
}
export interface HealPlan {
  groups: HealGroup[];
  /** Every finding id a heal item answers; the inbox draws them in the Heal row, not on their own. */
  covered: ReadonlySet<string>;
  hard: ReadonlyMap<string, { ids: number[]; covers: string[]; note: string }>;
}

type Element = DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number];
type Connector = Element["connectors"][number];
interface End {
  k: string;
  e: Element;
  c: Connector;
  cls: string | null;
  axis: number[] | null;
  issue: string | null;
}

const dist = (p: number[], q: number[]) => Math.hypot(...p.map((v, k) => v - q[k]!));
const sub = (p: number[], q: number[]) => p.map((v, k) => v - q[k]!);
const dot = (p: number[], q: number[]) => p.reduce((s, v, k) => s + v * q[k]!, 0);
const unit = (p: number[]) => {
  const n = Math.hypot(...p);
  return n < 1e-9 ? null : p.map((v) => v / n);
};
const classOf = (v: string | null | undefined) => {
  const c = v?.replace(/\s+/g, "");
  return c && !c.startsWith("Undefined") ? c : null;
};
const isSegment = (e: Element): e is DuctSnapshot["segments"][number] => "polyline" in e;
const straightDuct = (e: Element) => isSegment(e) && e.kind === "duct" && e.polyline.length === 2;
/** A connector's outward axis: Revit's facing, else a straight duct's run out of that end. */
const axisOf = (e: Element, c: Connector) => {
  if (c.facing?.length === 3) return unit(c.facing);
  if (!straightDuct(e)) return null;
  const s = e as DuctSnapshot["segments"][number];
  const far =
    dist(s.polyline[0]!, c.point) < dist(s.polyline[1]!, c.point) ? s.polyline[1]! : s.polyline[0]!;
  return unit(sub(c.point, far));
};
const dims = (c: Connector) =>
  c.shape === "round"
    ? [c.diameterIn ?? NaN, c.diameterIn ?? NaN]
    : [c.widthIn ?? NaN, c.heightIn ?? NaN];
const sameSize = (a: Connector, b: Connector) =>
  a.shape === b.shape && dims(a).every((v, i) => Math.abs(v - dims(b)[i]!) <= SIZE_TOL_IN);
const sizeWord = (c: Connector) =>
  c.shape === "round"
    ? `${c.diameterIn ?? "?"} in round`
    : `${c.widthIn ?? "?"}x${c.heightIn ?? "?"} in`;
export const proximityId = (a: string, b: string) =>
  `proximity:${[a, b]
    .sort((x, y) => {
      const [xi, xc] = x.split(":").map(Number);
      const [yi, yc] = y.split(":").map(Number);
      return xi! - yi! || xc! - yc!;
    })
    .join("|")}`;

const FIX = "Fix it in Revit; its own tools enforce the rules its API does not.";

const plans = new WeakMap<DuctSnapshot, { key: string; plan: HealPlan }>();

export function rememberHealPlan(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null,
  plan: HealPlan,
) {
  plans.set(snapshot, { key: topologyRulingsKey(withStoredRulings(work, snapshot.store)), plan });
}

/** Only edit topology verdicts affect healing; a unit-flow edit cannot rebuild it. */
export function healPlan(snapshot: DuctSnapshot, work: DuctsRouteDocument | null = null): HealPlan {
  const key = topologyRulingsKey(withStoredRulings(work, snapshot.store));
  const hit = plans.get(snapshot);
  if (hit?.key === key) return hit.plan;
  const plan = build(snapshot, work);
  plans.set(snapshot, { key, plan });
  return plan;
}

function build(snapshot: DuctSnapshot, raw: DuctsRouteDocument | null): HealPlan {
  // A stored ruling (an end left out) holds like a edit one (`rulings.ts`).
  const work = withStoredRulings(raw, snapshot.store);
  const tolerated = tolerate(snapshot, work);
  const groupOf = new Map(
    [...tolerated.snapshot.nodes, ...tolerated.snapshot.segments].map((e) => [
      e.id,
      e.groupId ?? null,
    ]),
  );
  const issueOf = new Map(
    snapshot.issues.flatMap((i) =>
      i.kind === "open-end" && i.elementId != null
        ? [[`${i.elementId}:${i.id.split(":").at(-1)}`, i.id]]
        : [],
    ),
  );
  const tapped = new Set([
    ...tolerated.taps.map((t) => t.a),
    ...tolerated.inline.flatMap((x) => x.ports),
  ]);
  const ends: End[] = [...snapshot.nodes, ...snapshot.segments].flatMap((e) =>
    e.kind === "cap" || e.kind === "equipment"
      ? []
      : e.connectors
          .filter((c) => !c.connectedTo && c.kind === "end" && c.point.length === 3)
          .map((c) => {
            const k = `${e.id}:${c.index}`;
            return {
              k,
              e,
              c,
              cls: classOf(c.classification) ?? classOf(e.classification),
              axis: axisOf(e, c),
              issue: issueOf.get(k) ?? null,
            };
          }),
  );
  const ruled = (x: End) => x.issue != null && verdictOf(work, x.issue) === "ignore";
  const live = ends.filter((x) => !ruled(x));
  // Two ends Revit already connects through the network (a stub and a riser around a bend) never
  // face each other: joining them closes a loop. Each is its own dangling end.
  const matches = (x: End, y: End) =>
    x.e.id !== y.e.id &&
    (x.e.groupId == null || x.e.groupId !== y.e.groupId) &&
    (x.cls == null || y.cls == null || x.cls === y.cls);
  const nearest = (x: End) => {
    let best: { y: End; d: number } | null = null;
    for (const y of live) {
      if (!matches(x, y)) continue;
      const d = dist(x.c.point, y.c.point) * 12;
      if (d <= HEAL_DANGLING_IN && (!best || d < best.d)) best = { y, d };
    }
    return best;
  };
  const hard: Map<string, { ids: number[]; covers: string[]; note: string }> = new Map();
  const covered = new Set<string>();
  const items: HealItem[] = [];
  const say = (x: End, why: string) => {
    if (x.issue) hard.set(x.issue, { ids: [x.e.id], covers: [x.issue], note: `${why}. ${FIX}` });
  };
  const named = (x: End) => subjectName(x.e.kind, "label" in x.e ? x.e.label : null);
  const done = new Set<string>();

  for (const x of live) {
    if (done.has(x.k)) continue;
    if (tapped.has(x.k)) {
      say(x, `${named(x)} lands on a duct's side or inside it: a takeoff`);
      continue;
    }
    const near = nearest(x);
    if (!near) {
      if (straightDuct(x.e) || x.e.kind === "fitting") {
        items.push({
          key: `cap:${x.k}`,
          kind: "cap",
          how: "cap",
          end: x.k,
          gapIn: 0,
          ids: [x.e.id],
          covers: x.issue ? [x.issue] : [],
        });
        done.add(x.k);
      } else
        say(
          x,
          x.e.kind === "terminal"
            ? `${named(x)} is not connected to a duct`
            : `${named(x)} ends with nothing within ${HEAL_DANGLING_IN} in, and only a duct or a fitting takes a cap: a missing run or a cap`,
        );
      continue;
    }
    const y = near.y;
    const back = nearest(y);
    const join = proximityId(x.k, y.k);
    const why = (words: string) => {
      hard.set(join, {
        ids: [x.e.id, y.e.id],
        covers: [
          join,
          join.replace("proximity:", "missed-join:"),
          ...[x.issue, y.issue].filter((id): id is string => id != null),
        ],
        note: `${words}. ${FIX}`,
      });
      done.add(x.k).add(y.k);
    };
    if (back?.y !== x || tapped.has(y.k)) {
      say(
        x,
        `${named(x)} has open ends near it (the nearest is ${named(y)}, ${near.d.toFixed(1)} in away): not a clean pair`,
      );
      continue;
    }
    const gap = near.d;
    if (!sameSize(x.c, y.c)) {
      why(
        `${named(x)} (${sizeWord(x.c)}) and ${named(y)} (${sizeWord(y.c)}) differ in size: a transition`,
      );
      continue;
    }
    if ((x.e.systemName ?? null) !== (y.e.systemName ?? null)) {
      why(
        `${named(x)} is on ${x.e.systemName ?? "no system"} and ${named(y)} on ${y.e.systemName ?? "no system"}: joining them merges systems`,
      );
      continue;
    }
    if (gap > HEAL_JOIN_GAP_IN) {
      why(
        `${named(x)} and ${named(y)} are ${gap.toFixed(1)} in apart, past the ${HEAL_JOIN_GAP_IN} in heal limit`,
      );
      continue;
    }
    let how: HealHow = "connect";
    if (gap > HEAL_COINCIDENT_IN) {
      const r = sub(y.c.point, x.c.point);
      const lateral =
        x.axis && y.axis
          ? Math.hypot(...r.map((v, k) => v - x.axis![k]! * dot(r, x.axis!))) * 12
          : Infinity;
      const facing = x.axis && y.axis && dot(x.axis, y.axis) <= -OPPOSED_COS && dot(r, x.axis) > 0;
      const rolled =
        x.c.shape === "rectangular" &&
        x.c.widthAxis?.length === 3 &&
        y.c.widthAxis?.length === 3 &&
        Math.abs(dot(x.c.widthAxis, y.c.widthAxis)) < OPPOSED_COS;
      if (!facing || lateral > HEAL_LATERAL_IN || rolled) {
        why(`${named(x)} and ${named(y)} are ${gap.toFixed(2)} in apart but not on one axis`);
        continue;
      }
      if (x.e.kind === "terminal" || y.e.kind === "terminal") {
        why(`a terminal sits ${gap.toFixed(2)} in off its duct`);
        continue;
      }
      if (straightDuct(x.e) && straightDuct(y.e)) how = "union";
      else if (straightDuct(x.e) || straightDuct(y.e)) how = "extend";
      else {
        why(
          `${named(x)} and ${named(y)} are ${gap.toFixed(2)} in apart with no straight duct to extend`,
        );
        continue;
      }
    }
    const [a, b] = [x, y].sort((p, q) => p.e.id - q.e.id || p.c.index - q.c.index);
    items.push({
      key: `join:${a!.k}|${b!.k}`,
      kind: "join",
      how,
      end: a!.k,
      other: b!.k,
      gapIn: gap,
      ids: [a!.e.id, b!.e.id],
      covers: [join, ...[a!.issue, b!.issue].filter((i): i is string => i != null)],
    });
    done.add(x.k).add(y.k);
  }

  // A join touches the groups of both its ends; it is listed under each, and healed once.
  const byGroup = new Map<string, HealItem[]>();
  for (const item of items) {
    for (const c of item.covers) covered.add(c);
    for (const g of new Set(
      item.ids.map((id) => groupOf.get(id)).filter((g): g is string => g != null),
    ))
      byGroup.set(g, [...(byGroup.get(g) ?? []), item]);
  }
  return {
    groups: [...byGroup]
      .map(([group, list]) => ({ group, items: list }))
      .sort((p, q) => p.group.localeCompare(q.group)),
    covered,
    hard,
  };
}

export const healRequestGroup = (group: HealGroup, only?: ReadonlySet<string>) => ({
  group: group.group,
  items: group.items
    .filter((i) => !only || only.has(i.key))
    .map((i) => ({ key: i.key, kind: i.kind, end: i.end, ...(i.other ? { other: i.other } : {}) })),
});

/** Fold one repair's ends and join before either the inbox or picture numbers findings. */
export function healFindings(findings: readonly DuctFinding[], plan: HealPlan | null = null) {
  const repairs = new Map(
    [...(plan?.hard ?? [])].flatMap(([id, repair]) =>
      repair.covers.map((key) => [key, { id, ...repair }] as const),
    ),
  );
  const seen = new Set<string>();
  return findings.flatMap((f) => {
    const repair = repairs.get(f.id);
    const id = repair?.id ?? f.id;
    if (seen.has(id)) return [];
    seen.add(id);
    if (!repair) return [{ ...f, findingIds: [id] }];
    return [
      {
        ...f,
        id,
        elementIds: repair.ids,
        note: repair.note,
        kind: repair.ids.length > 1 ? "open-end" : f.kind,
        groupId: null,
        grade: undefined,
        findingIds: repair.covers,
      },
    ];
  });
}
