/**
 * The one encoding substrate of the /ducts drawings: an encoding sorts each drawn segment into one
 * of its bins, and a bin is the stroke (ink, width, dash) and the legend row. The plan and the
 * isometric draw every segment through `strokeOf`, so a new reading of the network is one case in
 * `encodingFor`, never a new drawing. A quantity's breaks and max come from the drawn group
 * (`encodingFor(key, facts)`), so a scale is never spent on values the group does not hold. Issue
 * inks come only from `ISSUE_KINDS` (`issues.tsx`) by their `blocks` class; everything else is a
 * house token.
 */
import type { Blocks } from "@pe/ducts-domain/issues";
import type { DuctInferenceGrade } from "@pe/agent-contracts";
import type { DashRole } from "@pe/kit/lib/token";
import { token } from "@pe/kit/lib/token";
import { VERDICT_INK } from "@pe/kit/table/cells";
import { ISSUE_KINDS } from "./issues";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Claim, Leg } from "./legs";

export type Segment = DuctSnapshot["segments"][number];
export type DuctNode = DuctSnapshot["nodes"][number];
export type Issue = DuctSnapshot["issues"][number];

/** Pe's own loss at one element (`lossesOf`, `scene.ts`): the summed `dp` of its priced rows, in-wg. */
interface PressurePoint {
  drop: number | null;
}

/** What an encoding may read about one drawn segment. */
export interface EncodingFacts {
  segment?: Segment;
  /** Pass-1 flow (derived), or null where pass 1 did not reach. */
  derivedCfm?: number | null;
  issues: readonly Issue[];
  pressure?: PressurePoint;
  /** The subject leg the element lies on (`subjectScene`); null off every leg, absent in a group scene. */
  leg?: Leg | null;
}
export interface SegmentFacts extends EncodingFacts {
  segment: Segment;
  derivedCfm: number | null;
}

export interface Stroke {
  ink: string;
  /** Screen px at every zoom. */
  width: number;
  dash: DashRole | null;
}

interface Bin {
  word: string;
  says: string;
  stroke: Stroke;
}

/** How a scale reads: one quantity's numbers over the drawn group, for the legend and the tree. */
export interface Quantity {
  unit: string;
  digits: number;
  /** Element id → its value, over every element of the group that has one. */
  of: ReadonlyMap<number, number>;
  min: number | null;
  max: number | null;
  /** The element that holds the max: the legend names it and the tree's full bar is it. */
  maxId: number | null;
  /** The breaks between bins, ascending; empty for a quantity drawn without bins (flow). */
  edges: readonly number[];
}

export type ScaleKind = "plain" | "categorical" | "sequential" | "weight" | "flow";

export interface Encoding {
  key: EncodingKey;
  label: string;
  says: string;
  kind: ScaleKind;
  /** The `ducts.snapshot` layer whose query and coverage the legend prints; null = none. */
  layer: string | null;
  /** Bins in legend order. */
  bins: Record<string, Bin>;
  bin: (facts: EncodingFacts) => string;
  /** Node glyphs take the bin's ink too (Pe's loss prices fittings and terminals). */
  nodes?: boolean;
  quantity?: Quantity;
  /** Flow: +1 when air runs from the polyline's first point to its last, -1 against, null unknown. */
  arrow?: (facts: EncodingFacts) => 1 | -1 | null;
}

/** The registered dash classes (base.css), by role. */
export const DASH_CLASS: Record<DashRole, string> = {
  seam: "dash-seam",
  reference: "dash-reference",
  void: "dash-void",
};

/** Missing data is drawn, never blank: a thin dashed mute line says "no value here". */
const MISSING: Stroke = { ink: VERDICT_INK.mute, width: 1.25, dash: "void" };
const CLEAN_INK = VERDICT_INK.ink;
const PLAIN: Stroke = { ink: CLEAN_INK, width: 2, dash: null };

/**
 * One sequential hue, light to dark, from the house viz token: four mixes toward the page and one
 * toward the ink. Validated as an ordinal ramp (dataviz `validateOrdinal`) on the page in both
 * themes: light end >= 2:1, adjacent steps >= 0.06 L apart, one hue.
 */
const RAMP = [45, 62, 80, 100, 155] as const;
const rampInk = (role: string, step: number) =>
  step <= 100
    ? `color-mix(in oklab, ${token(role)} ${step}%, ${token("page")})`
    : `color-mix(in oklab, ${token("ink")} ${step - 100}%, ${token(role)})`;
/** `n` ramp steps spanning both ends: fewer bins never lose the darkest step. */
const rampOf = (role: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    rampInk(role, RAMP[n === 1 ? RAMP.length - 1 : Math.round((i * (RAMP.length - 1)) / (n - 1))]!),
  );

/**
 * A quantity's number as a person reads it: whole for a count-like unit, else its digits, and two
 * significant figures under one so a small drop never prints as 0.000.
 */
export const formatQuantity = (q: Pick<Quantity, "digits">, n: number) => {
  if (q.digits === 0) return String(Math.round(n));
  if (n === 0 || Math.abs(n) >= 1) return n.toFixed(q.digits);
  return n.toFixed(Math.max(q.digits, 1 - Math.floor(Math.log10(Math.abs(n)))));
};

/** Two significant figures, so a break reads as a number a person would say. */
const round2 = (n: number) => (n === 0 ? 0 : Number(n.toPrecision(2)));

/**
 * Equal-count (quantile) breaks: the group's values cut into `n` bins of about as many elements
 * each, so every step of the ramp is spent on elements that exist. Ties collapse a break; the top
 * is the group's max, never a fixed ceiling.
 */
function quantileEdges(values: readonly number[], n: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 2) return [];
  const edges: number[] = [];
  for (let i = 1; i < n; i++) {
    const edge = round2(sorted[Math.floor((i * sorted.length) / n)]!);
    if (edge > sorted[0]! && edge <= sorted.at(-1)! && edge > (edges.at(-1) ?? -Infinity))
      edges.push(edge);
  }
  return edges;
}

/** What `encodingFor` reads: one group's drawn facts. */
export interface GroupFacts {
  segments: readonly SegmentFacts[];
  nodes: readonly (EncodingFacts & { node: { id: number } })[];
}

function quantityOf(
  facts: GroupFacts,
  read: (f: EncodingFacts) => number | null | undefined,
  nodes: boolean,
  unit: string,
  digits: number,
): Quantity {
  const of = new Map<number, number>();
  for (const f of facts.segments) {
    const v = read(f);
    if (v != null) of.set(f.segment.id, v);
  }
  if (nodes)
    for (const f of facts.nodes) {
      const v = read(f);
      if (v != null) of.set(f.node.id, v);
    }
  let maxId: number | null = null;
  for (const [id, v] of of) if (maxId == null || v > of.get(maxId)!) maxId = id;
  const values = [...of.values()];
  return {
    unit,
    digits,
    of,
    min: values.length ? Math.min(...values) : null,
    max: maxId == null ? null : of.get(maxId)!,
    maxId,
    edges: [],
  };
}

/** Bins for a quantity: `edges` are the upper bounds of all but the last bin. */
function binsOf(
  quantity: Quantity,
  edges: readonly number[],
  strokes: readonly Stroke[],
  missing: string,
): Record<string, Bin> {
  const { unit } = quantity;
  const f = (n: number) => formatQuantity(quantity, n);
  const lows = [quantity.min ?? 0, ...edges];
  const highs = [...edges, quantity.max ?? edges.at(-1) ?? 0];
  const bins: Record<string, Bin> = {};
  strokes.forEach((stroke, i) => {
    bins[`b${i}`] = {
      word: `${f(lows[i]!)}–${f(highs[i]!)} ${unit}`,
      says: `from ${f(lows[i]!)} up to ${f(highs[i]!)} ${unit}`,
      stroke,
    };
  });
  bins.missing = { word: "no value", says: missing, stroke: MISSING };
  return bins;
}

const binIndex = (edges: readonly number[], value: number) => {
  const i = edges.findIndex((edge) => value < edge);
  return `b${i === -1 ? edges.length : i}`;
};

interface QuantitySpec {
  role: string;
  label: string;
  says: string;
  layer: string | null;
  unit: string;
  digits: number;
  missing: string;
  read: (facts: EncodingFacts) => number | null | undefined;
  nodes?: boolean;
}

const SEQUENTIAL: Record<"velocity" | "revit-pressure-drop" | "pressure-drop", QuantitySpec> = {
  velocity: {
    role: "viz-1",
    label: "velocity (Revit)",
    says: "Velocity as Revit reports it (RBS_VELOCITY): five equal-count steps of one hue, darkest at the system's max",
    layer: "revit-flow",
    unit: "fpm",
    digits: 0,
    missing: "Revit reports no velocity: the segment is outside a calculated system",
    read: ({ segment }) => segment?.revit.velocityFpm,
  },
  "revit-pressure-drop": {
    role: "viz-5",
    label: "pressure drop (Revit)",
    says: "Pressure drop as Revit reports it, friction only: five equal-count steps of one hue, darkest at the system's max",
    layer: "revit-pressure",
    unit: "in-wg",
    digits: 3,
    missing: "Revit reports no pressure drop on this segment",
    read: ({ segment }) => segment?.revit.pressureDropInWg,
  },
  "pressure-drop": {
    role: "viz-5",
    label: "loss (Pe)",
    says: "Pe's priced loss per element as Revit holds it now (friction intervals add; a fitting or terminal shows its largest leg): five equal-count steps, darkest at the system's max",
    layer: null,
    unit: "in-wg",
    digits: 3,
    missing: "Pe prices no loss on this element",
    read: ({ pressure }) => pressure?.drop,
    nodes: true,
  },
};

function sequential(key: keyof typeof SEQUENTIAL, facts: GroupFacts): Encoding {
  const spec = SEQUENTIAL[key];
  const counted = quantityOf(facts, spec.read, spec.nodes ?? false, spec.unit, spec.digits);
  const edges = quantileEdges([...counted.of.values()], RAMP.length);
  const quantity = { ...counted, edges };
  const strokes = rampOf(spec.role, edges.length + 1).map(
    (ink): Stroke => ({ ink, width: 3, dash: null }),
  );
  return {
    key,
    kind: "sequential",
    label: spec.label,
    says: spec.says,
    layer: spec.layer,
    nodes: spec.nodes,
    quantity,
    bins: binsOf(quantity, edges, strokes, spec.missing),
    bin: (f) => {
      const value = spec.read(f);
      return value == null ? "missing" : binIndex(edges, value);
    },
  };
}

/** Equivalent round diameter, in: a rectangle's by Huebscher, a round's own. */
const equivalentIn = (segment: Segment): number | null => {
  if (segment.diameterIn != null) return segment.diameterIn;
  const a = segment.widthIn;
  const b = segment.heightIn;
  return a != null && b != null ? (1.3 * (a * b) ** 0.625) / (a + b) ** 0.25 : null;
};

const SIZE_WIDTHS = [1.5, 3, 5.5] as const;

function size(facts: GroupFacts): Encoding {
  const read = ({ segment }: EncodingFacts) => (segment ? equivalentIn(segment) : null);
  const counted = quantityOf(facts, read, false, "in", 1);
  const edges = quantileEdges([...counted.of.values()], SIZE_WIDTHS.length);
  const quantity = { ...counted, edges };
  const widths = SIZE_WIDTHS.slice(SIZE_WIDTHS.length - (edges.length + 1));
  return {
    key: "size",
    kind: "weight",
    label: "size",
    says: "Line weight is the duct's equivalent round diameter (a rectangle's by Huebscher): three equal-count steps",
    layer: null,
    quantity,
    bins: binsOf(
      quantity,
      edges,
      widths.map((width): Stroke => ({ ink: CLEAN_INK, width, dash: null })),
      "the snapshot carries no size for this segment",
    ),
    bin: (f) => {
      const value = read(f);
      return value == null ? "missing" : binIndex(edges, value);
    },
  };
}

function flow(facts: GroupFacts, directions: ReadonlyMap<number, 1 | -1>): Encoding {
  const read = ({ segment, derivedCfm }: EncodingFacts) => derivedCfm ?? segment?.revit.flowCfm;
  const quantity = quantityOf(facts, read, false, "cfm", 0);
  const arrow = ({ segment }: EncodingFacts) =>
    segment ? (directions.get(segment.id) ?? null) : null;
  return {
    key: "flow",
    kind: "flow",
    label: "flow",
    says: "Arrows run with the air, out from the fan's port along the walk (against it on a return or exhaust); dashed where the walk cannot say",
    layer: "pass1-flow",
    quantity,
    arrow,
    bins: {
      known: {
        word: "with the air",
        says: "the walk from the fan reached it; the arrow points downstream",
        stroke: PLAIN,
      },
      unknown: {
        word: "direction unknown",
        says: "the walk from the fan never reached it, or the system names no direction",
        stroke: { ink: CLEAN_INK, width: 2, dash: "seam" },
      },
    },
    bin: (f) => (arrow(f) == null ? "unknown" : "known"),
  };
}

/** The worst `blocks` class among a set of issues, in readiness order. */
const WORST: readonly Blocks[] = ["walkable", "budgetable", "none"];
const worstBlocks = (issues: readonly Issue[]): Blocks | null =>
  WORST.find((blocks) => issues.some((issue) => ISSUE_KINDS[issue.kind].blocks === blocks)) ?? null;

/** One ink per `blocks` class, taken from the class's `ISSUE_KINDS` tone. */
const blocksInk = (blocks: Blocks) =>
  VERDICT_INK[Object.values(ISSUE_KINDS).find((info) => info.blocks === blocks)!.color.tone];

/**
 * The encodings that need no numbers from the group. Health's two blocking tones sit close under
 * deuteranopia (alarm against caution, OKLab ΔE ~1), so weight carries severity too: the worse
 * the class, the heavier the line; the advisory class is dashed.
 */
const fixed = (): Record<"none" | "health" | "legs" | "provenance", Encoding> => ({
  none: {
    key: "none",
    kind: "plain",
    label: "none",
    says: "Every segment in plain ink: the drawing without a reading",
    layer: null,
    bins: { plain: { word: "segment", says: "a segment of this system", stroke: PLAIN } },
    bin: () => "plain",
  },
  health: {
    key: "health",
    kind: "categorical",
    label: "health",
    says: "Each segment in the ink of its worst issue's class, heavier the worse; clean segments thin and plain",
    layer: "issues",
    bins: {
      walkable: {
        word: "blocks walking",
        says: "an issue on it keeps a walk from the root from reaching every terminal",
        stroke: { ink: blocksInk("walkable"), width: 5, dash: null },
      },
      budgetable: {
        word: "blocks the budget",
        says: "an issue on it leaves a static or a drop unknown",
        stroke: { ink: blocksInk("budgetable"), width: 3.5, dash: null },
      },
      none: {
        word: "advisory",
        says: "an advisory issue only; it blocks nothing",
        stroke: { ink: blocksInk("none"), width: 2, dash: "seam" },
      },
      clean: {
        word: "no issue",
        says: "no issue names this segment",
        stroke: { ink: CLEAN_INK, width: 1.5, dash: null },
      },
    },
    bin: (facts) => worstBlocks(facts.issues) ?? "clean",
  },
  legs: {
    key: "legs",
    kind: "categorical",
    label: "legs",
    says: "The subject's legs at full weight, cut at equipment, accessories, terminals, caps and level crossings; an element the cut put on no leg is a place or a gap edge",
    layer: null,
    bins: {
      leg: {
        word: "on a leg",
        says: "a subject element inside one leg",
        stroke: { ink: CLEAN_INK, width: 3.5, dash: null },
      },
      off: {
        word: "off every leg",
        says: "a subject element the cut placed on no leg: a place, or the edge of a gap",
        stroke: { ink: VERDICT_INK.mute, width: 2, dash: "seam" },
      },
    },
    bin: ({ leg }) => (leg ? "leg" : "off"),
  },
  // Blue against the warm viz hue: adjacent CVD ΔE 14.9, normal 16.8 (dataviz validator, light).
  provenance: {
    key: "provenance",
    kind: "categorical",
    label: "provenance",
    says: "Where the segment's flow comes from: Revit's calculation, the pass-1 walk, or geometry only",
    layer: null,
    bins: {
      "revit-reported": {
        word: "Revit-reported",
        says: "Revit reports flow on this segment",
        stroke: { ink: token("viz-1"), width: 2.5, dash: null },
      },
      derived: {
        word: "derived only",
        says: "no Revit flow; the pass-1 walk derived one",
        stroke: { ink: token("viz-5"), width: 2.5, dash: null },
      },
      geometry: {
        word: "geometry only",
        says: "size and length only: neither Revit nor pass 1 knows its flow",
        stroke: MISSING,
      },
    },
    bin: ({ segment, derivedCfm }) =>
      segment?.revit.flowCfm != null
        ? "revit-reported"
        : derivedCfm != null
          ? "derived"
          : "geometry",
  },
});

/** The picker's order: nothing, the categorical readings, then the quantities. */
export const ENCODING_KEYS = [
  "none",
  "health",
  "size",
  "flow",
  "velocity",
  "revit-pressure-drop",
  "pressure-drop",
  "legs",
  "provenance",
] as const;
export type EncodingKey = (typeof ENCODING_KEYS)[number];

const EMPTY: GroupFacts = { segments: [], nodes: [] };

/**
 * The encoding for `key` over one group's facts: a quantity's breaks and max come from the group,
 * so the same key reads per group and never against a fixed ceiling. An unknown key is `health`.
 * `directions` are the flow walk's (`flowDirections`); absent, every arrow is unknown.
 */
export function encodingFor(
  key: string,
  facts: GroupFacts = EMPTY,
  directions: ReadonlyMap<number, 1 | -1> = new Map(),
): Encoding {
  switch (key) {
    case "velocity":
    case "revit-pressure-drop":
    case "pressure-drop":
      return sequential(key, facts);
    case "size":
      return size(facts);
    case "flow":
      return flow(facts, directions);
    case "none":
    case "legs":
    case "provenance":
      return fixed()[key];
    default:
      return fixed().health;
  }
}

export const strokeOf = (encoding: Encoding, facts: EncodingFacts): Stroke =>
  encoding.bins[encoding.bin(facts)]!.stroke;

/** A node glyph's ink: its worst issue class under health, else plain. */
export const nodeInk = (encoding: Encoding, issues: readonly Issue[]) => {
  const worst = encoding.key === "health" ? worstBlocks(issues) : null;
  return worst ? blocksInk(worst) : CLEAN_INK;
};

/** A claim pin's ink by its state, through the same tones an issue wears: proven done, assumed caution, unproven alarm. */
const CLAIM_TONE: Record<Claim["state"], keyof typeof VERDICT_INK> = {
  proven: "done",
  assumed: "caution",
  unproven: "alarm",
};
export const claimInk = (claim: Pick<Claim, "state">) => VERDICT_INK[CLAIM_TONE[claim.state]];

/** An inferred break's ink by its grade (`provisional.tsx` tones); a near miss or a confirmed one is plain ink. */
export const inferredInk = ({
  grade,
  confirmed,
}: {
  grade: DuctInferenceGrade;
  confirmed: boolean;
}) =>
  confirmed || grade === "near-miss"
    ? token("ink-2")
    : VERDICT_INK[grade === "anomalous" ? "alarm" : "caution"];

/** An issue marker's ink: its kind's tone, from `ISSUE_KINDS` only. */
export const issueInk = (issue: Issue) => VERDICT_INK[ISSUE_KINDS[issue.kind].color.tone];
