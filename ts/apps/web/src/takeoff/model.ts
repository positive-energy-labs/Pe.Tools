/** A zone as drawn on a zoning view: loops in sheet inches, even-odd. Lives in a private fixture (zones.json), never in the bundle. */
export interface DeclaredZone {
  view: string;
  typeName: string;
  color: string | null;
  comments: string | null;
  loops: [number, number][][];
}
import { boundsOf, type AffineFrame, type Bounds2 } from "#/lib/affine-frame";

export type { CandidateRegion } from "@pe/agent-contracts";

interface LevelLane {
  view: string;
  label: string;
  levelFragment: string;
  replayFile: string;
}

const LEVEL_LANES: LevelLane[] = [
  {
    view: "Mechanical Zoning Plan - Lower Level",
    label: "Lower",
    levelFragment: "Lower",
    replayFile: "replay_Level_0_Lower_Level.bin",
  },
  {
    view: "Mechanical Zoning Plan - Main Level",
    label: "Main",
    levelFragment: "Main",
    replayFile: "replay_Level_1_Main_Level.bin",
  },
  {
    view: "Mechanical Zoning Plan - Upper Level",
    label: "Upper",
    levelFragment: "Upper",
    replayFile: "replay_Level_2_Upper_Level.bin",
  },
  {
    view: "Mechanical Zoning Plan - Attic Level",
    label: "Attic",
    levelFragment: "Attic",
    replayFile: "replay_Level_3_Attic.bin",
  },
];

export interface Zone extends Omit<DeclaredZone, "color"> {
  color: string;
  lane: LevelLane;
  key: string;
  ordinal: number;
  guid: string;
  declaredSqft: number;
  bounds: Bounds2;
}

const zoneGuid = (levelIndex: number, ordinal: number) =>
  `7a4e0000-0000-4000-8000-${String(levelIndex).padStart(6, "0")}${String(ordinal).padStart(6, "0")}`;

const shoelace = (loop: readonly (readonly [number, number])[]) => {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
};

export const loopBounds = (loops: readonly (readonly (readonly [number, number])[])[]) =>
  boundsOf(loops.flat());

export function containsEvenOdd(
  loops: readonly (readonly (readonly [number, number])[])[],
  x: number,
  y: number,
) {
  let inside = false;
  for (const loop of loops) {
    const m = loop.length;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const [xi, yi] = loop[i]!;
      const [xj, yj] = loop[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function pathD(
  loops: readonly (readonly (readonly [number, number])[])[],
  frame: Pick<AffineFrame, "toViewport">,
): string {
  return loops
    .filter((loop) => loop.length >= 3)
    .map(
      (loop) =>
        loop
          .map(([x, y], i) => {
            const [px, py] = frame.toViewport([x, y]);
            return `${i === 0 ? "M" : "L"}${px.toFixed(3)} ${py.toFixed(3)}`;
          })
          .join("") + "Z",
    )
    .join("");
}

export function buildZones(declared: DeclaredZone[]): Zone[] {
  const zones: Zone[] = [];
  LEVEL_LANES.forEach((lane, levelIndex) => {
    declared
      .filter((z) => z.view === lane.view)
      .forEach((z, i) => {
        const ordinal = i + 1;
        zones.push({
          ...z,
          color: z.color ?? "0,0,0",
          lane,
          ordinal,
          key: `${lane.label}#${String(ordinal).padStart(2, "0")}`,
          guid: zoneGuid(levelIndex, ordinal),
          declaredSqft: z.loops.reduce((sum, loop) => sum + shoelace(loop), 0),
          bounds: loopBounds(z.loops),
        });
      });
  });
  return zones;
}

export const FLAG_MEANING: Record<string, string> = {
  seedless: "no seed room backs this space — verify it is a real room",
  "suspect:narrow": "narrow enough that the boundary may be a wall band, not a room",
  "suspect:ceiling-variance": "ceiling height varies across the space — chase, void, or vault",
  "low-evidence-boundary": "boundary placed on weak wall evidence",
  "orphaned-region": "an existing region no room in this run claims",
  "materialize-failed": "Revit refused the loop — dropped whole rather than bent to fit",
  "unhomed-proposal":
    "this rerun found a room with no materialized region yet — accept to materialize it, or dismiss to drop it",
};
