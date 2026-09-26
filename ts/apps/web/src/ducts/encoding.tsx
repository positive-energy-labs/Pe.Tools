/**
 * The one encoding substrate of the /ducts drawings: an encoding sorts each drawn segment into one
 * of its bins, and a bin is the stroke (ink, width, dash) and the legend row. The plan and the
 * isometric draw every segment through `strokeOf`, so a new reading of the network (pass-2
 * pressure drop) is one entry in `ENCODINGS`, never a new drawing. Issue inks come only from
 * `ISSUE_KINDS` (`issues.tsx`) by their `blocks` class; everything else is a house token.
 */
import type { DashRole } from "#/lib/token";
import { token } from "#/lib/token";
import { VERDICT_INK } from "#/components/master-table/cells";
import { ISSUE_KINDS, type Blocks } from "./issues";
import type { DuctSnapshot } from "./readiness";

export type Segment = DuctSnapshot["segments"][number];
export type DuctNode = DuctSnapshot["nodes"][number];
export type Issue = DuctSnapshot["issues"][number];

/** What an encoding may read about one drawn segment. */
export interface SegmentFacts {
  segment: Segment;
  /** Pass-1 flow (derived), or null where pass 1 did not reach. */
  derivedCfm: number | null;
  issues: readonly Issue[];
}

export interface Stroke {
  ink: string;
  /** Screen px at every zoom. */
  width: number;
  dash: DashRole | null;
}

export interface Bin {
  word: string;
  says: string;
  stroke: Stroke;
}

export interface Encoding {
  label: string;
  says: string;
  /** The `ducts.snapshot` layer whose query and coverage the legend prints; null = none. */
  layer: string | null;
  /** Bins in legend order. */
  bins: Record<string, Bin>;
  bin: (facts: SegmentFacts) => string;
}

/** Missing data is drawn, never blank: a thin dashed mute line says "no value here". */
const MISSING: Stroke = { ink: VERDICT_INK.mute, width: 1.25, dash: "void" };
const mix = (role: string, pct: number) =>
  `color-mix(in oklab, ${token(role)} ${pct}%, ${token("page")})`;

/** A sequential scale over one viz hue: `edges` are the upper bounds of all but the last bin. */
function sequential(
  role: string,
  unit: string,
  edges: readonly number[],
  missing: string,
  read: (facts: SegmentFacts) => number | null | undefined,
  digits = 0,
): Pick<Encoding, "bins" | "bin"> {
  const f = (n: number) => n.toFixed(digits);
  const pct = (i: number) => Math.round(30 + (70 * i) / edges.length);
  const bins: Record<string, Bin> = {};
  edges.forEach((edge, i) => {
    const low = i === 0 ? null : edges[i - 1]!;
    bins[`b${i}`] = {
      word: low == null ? `< ${f(edge)} ${unit}` : `${f(low)}–${f(edge)} ${unit}`,
      says: `${low == null ? "under" : `from ${f(low)} to`} ${f(edge)} ${unit}`,
      stroke: { ink: mix(role, pct(i)), width: 2.5, dash: null },
    };
  });
  bins[`b${edges.length}`] = {
    word: `≥ ${f(edges.at(-1)!)} ${unit}`,
    says: `${f(edges.at(-1)!)} ${unit} or more`,
    stroke: { ink: mix(role, 100), width: 2.5, dash: null },
  };
  bins.missing = { word: "no value", says: missing, stroke: MISSING };
  return {
    bins,
    bin: (facts) => {
      const value = read(facts);
      if (value == null) return "missing";
      const i = edges.findIndex((edge) => value < edge);
      return `b${i === -1 ? edges.length : i}`;
    },
  };
}

/** The worst `blocks` class among a set of issues, in readiness order. */
const WORST: readonly Blocks[] = ["walkable", "budgetable", "none"];
export const worstBlocks = (issues: readonly Issue[]): Blocks | null =>
  WORST.find((blocks) => issues.some((issue) => ISSUE_KINDS[issue.kind].blocks === blocks)) ?? null;

/** One ink per `blocks` class, taken from the class's `ISSUE_KINDS` tone. */
const blocksInk = (blocks: Blocks) =>
  VERDICT_INK[Object.values(ISSUE_KINDS).find((info) => info.blocks === blocks)!.color.tone];

export const CLEAN_INK = VERDICT_INK.ink;

const flowWidths = [1.5, 2.5, 4, 6, 8] as const;
const FLOW_EDGES = [100, 300, 600, 1200] as const;

export const ENCODINGS = {
  health: {
    label: "health",
    says: "Each segment in the ink of its worst issue's class; clean segments in plain ink",
    layer: "issues",
    bins: {
      walkable: {
        word: "blocks walking",
        says: "an issue on it keeps a walk from the root from reaching every terminal",
        stroke: { ink: blocksInk("walkable"), width: 3, dash: null },
      },
      budgetable: {
        word: "blocks the budget",
        says: "an issue on it leaves a static or a drop unknown",
        stroke: { ink: blocksInk("budgetable"), width: 3, dash: null },
      },
      none: {
        word: "advisory",
        says: "an advisory issue only; it blocks nothing",
        stroke: { ink: blocksInk("none"), width: 2, dash: "seam" },
      },
      clean: {
        word: "no issue",
        says: "no issue names this segment",
        stroke: { ink: CLEAN_INK, width: 2, dash: null },
      },
    },
    bin: (facts) => worstBlocks(facts.issues) ?? "clean",
  },
  flow: {
    label: "flow (pass 1)",
    says: "Line width is the pass-1 flow: terminal design flow summed up the tree from the one root (derived)",
    layer: "pass1-flow",
    bins: {
      ...Object.fromEntries(
        [...FLOW_EDGES, Infinity].map((edge, i) => {
          const low = i === 0 ? 0 : FLOW_EDGES[i - 1]!;
          const word = edge === Infinity ? `≥ ${low} cfm` : `${low}–${edge} cfm`;
          return [
            `b${i}`,
            {
              word,
              says: `pass-1 flow ${word}`,
              stroke: { ink: CLEAN_INK, width: flowWidths[i]!, dash: null },
            },
          ];
        }),
      ),
      missing: {
        word: "no pass-1 flow",
        says: "pass 1 walks single-root, loop-free groups only; this segment was not reached",
        stroke: MISSING,
      },
    },
    bin: ({ derivedCfm }) => {
      if (derivedCfm == null) return "missing";
      const i = FLOW_EDGES.findIndex((edge) => derivedCfm < edge);
      return `b${i === -1 ? FLOW_EDGES.length : i}`;
    },
  },
  velocity: {
    label: "velocity (Revit)",
    says: "Velocity as Revit reports it (RBS_VELOCITY), on one sequential hue",
    layer: "revit-flow",
    ...sequential(
      "viz-1",
      "fpm",
      [400, 700, 1000, 1500, 2000],
      "Revit reports no velocity: the segment is outside a calculated system",
      ({ segment }) => segment.revit.velocityFpm,
    ),
  },
  "revit-pressure-drop": {
    label: "pressure drop (Revit)",
    says: "Pressure drop as Revit reports it, friction only; gray dashed where Revit reports none",
    layer: "revit-pressure",
    ...sequential(
      "viz-5",
      "in-wg",
      [0.005, 0.01, 0.02, 0.05],
      "Revit reports no pressure drop on this segment",
      ({ segment }) => segment.revit.pressureDropInWg,
      3,
    ),
  },
  provenance: {
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
        stroke: { ink: token("viz-2"), width: 2.5, dash: null },
      },
      geometry: {
        word: "geometry only",
        says: "size and length only: neither Revit nor pass 1 knows its flow",
        stroke: MISSING,
      },
    },
    bin: ({ segment, derivedCfm }) =>
      segment.revit.flowCfm != null
        ? "revit-reported"
        : derivedCfm != null
          ? "derived"
          : "geometry",
  },
} satisfies Record<string, Encoding>;

export type EncodingKey = keyof typeof ENCODINGS;
export const ENCODING_KEYS = Object.keys(ENCODINGS) as EncodingKey[];

export const encodingOf = (key: string): Encoding =>
  ENCODINGS[(key in ENCODINGS ? key : "health") as EncodingKey];

export const strokeOf = (encoding: Encoding, facts: SegmentFacts): Stroke =>
  encoding.bins[encoding.bin(facts)]!.stroke;

/** A node glyph's ink: its worst issue class under health, else plain. */
export const nodeInk = (encoding: Encoding, issues: readonly Issue[]) => {
  const worst = encoding === ENCODINGS.health ? worstBlocks(issues) : null;
  return worst ? blocksInk(worst) : CLEAN_INK;
};

/** An issue marker's ink: its kind's tone, from `ISSUE_KINDS` only. */
export const issueInk = (issue: Issue) => VERDICT_INK[ISSUE_KINDS[issue.kind].color.tone];
