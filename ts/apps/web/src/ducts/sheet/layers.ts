/**
 * The fan sheet's picture doors (protoui round 1): every blocker drawn where it can be drawn, with
 * the /ducts primitives only. Open ends and inferred joins are the finding shapes `/ducts` draws
 * (`finding-layers.ts`), read from the snapshot over the walked elements and kept only where a
 * blocker stands; flow, drop and pricing gaps are damage skins (`scene/damage.ts`); shared legs
 * and class changes are centreline marks; not-priced and implausible legs a dashed centreline
 * over their damage; a heal proposal is the amber heal volume, ghost until its pair is accepted.
 * The worst complete path draws heavy. Every layer carries `targets` and `findings`, so hover,
 * pick and pins work through the picture's one plumbing.
 */
import type { DuctsRouteDocument, DuctsSheetOverview } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { damageLayers } from "#/scene/damage";
import { inkOf } from "#/scene/ink";
import { markFrame, markLines } from "#/scene/marks";
import type { Layer3D, SceneMeshes } from "#/scene/types";
import { findingLayers, findingShapes, type FindingShapes } from "../finding-layers";
import type { StageIssue } from "../inbox-rows";
import type { Detail } from "./model";
import { isConsequence, presentIds, type SheetBlocker } from "./tiers";

type Kind = DuctsSheetOverview["blockers"][number]["kind"];
/** Kinds whose door is the element's damage skin. */
const DAMAGE: ReadonlySet<Kind> = new Set([
  "unknown-drop",
  "no-flow",
  "flow-mismatch",
  "not-priced",
  "implausible-loss",
  "equipment-pairing",
]);
/** Kinds whose door is the leg's centreline; dashed ones read as MISSING pricing. */
const CENTRELINE: ReadonlyMap<Kind, { dashed: boolean }> = new Map([
  ["shared-leg", { dashed: false }],
  ["class-change", { dashed: false }],
  ["not-priced", { dashed: true }],
  ["implausible-loss", { dashed: true }],
]);
/** Kinds whose door is a face finding the snapshot already draws. */
const FACE: ReadonlySet<Kind> = new Set(["open-end", "inferred-join"]);

type Edge = readonly [readonly number[], readonly number[]];
/** Half the arms of the cross a node draws, in feet (as `noRunLayers`). */
const CROSS = 0.25;

export interface SheetLayerInput {
  snapshot: DuctSnapshot;
  work: DuctsRouteDocument | null;
  overview: DuctsSheetOverview;
  inputs: Detail<"inputs"> | null;
  blockers: readonly SheetBlocker[];
  meshes: SceneMeshes | null;
  /** Element ids on the worst complete path(s), drawn heavy; the other paths stay thin. */
  worstPathIds: ReadonlySet<number>;
  /** The walked elements: the scope the snapshot's findings are read over. */
  focus: ReadonlySet<number>;
}

/** The elements a blocker stands on: its own, and the candidate or proposal it names. */
export const blockerElements = (blocker: SheetBlocker): number[] => [
  ...new Set(
    [
      blocker.elementId,
      blocker.closer.candidate?.toElementId,
      blocker.proposal?.to.elementId,
    ].filter((id): id is number => id != null),
  ),
];

/** Blockers as stage issues: the row identity every layer answers to (`targets[].key`). */
export function sheetIssues(
  blockers: readonly SheetBlocker[],
  shapes: FindingShapes | null,
): (StageIssue & { causedBy?: string })[] {
  const partsOf = (ids: readonly number[]) =>
    shapes
      ? [
          ...shapes.outlines,
          ...shapes.bars,
          ...shapes.missedBars,
          ...shapes.overhang,
          ...shapes.boxes,
        ]
          .filter((part) => ids.includes(part.elementId))
          .map((part) => part.finding)
      : [];
  const present = presentIds(blockers);
  return blockers.map((blocker) => {
    const ids = blockerElements(blocker);
    return {
      key: blocker.id,
      ids,
      findings: [...new Set([blocker.id, ...(FACE.has(blocker.kind) ? partsOf(ids) : [])])],
      damage: DAMAGE.has(blocker.kind) ? blocker.kind : null,
      // A consequence names its cause so the picture can dim and tether it; an orphan stands alone.
      ...(isConsequence(blocker, present) ? { causedBy: blocker.causedBy! } : {}),
    };
  });
}

/** The face shapes kept to the blockers' elements; a heal box is a ghost until its pair is accepted. */
export function blockerShapes(
  snapshot: DuctSnapshot,
  work: DuctsRouteDocument | null,
  blockers: readonly SheetBlocker[],
  inputs: Detail<"inputs"> | null,
  focus: ReadonlySet<number>,
): FindingShapes {
  const faced = blockers.filter((b) => FACE.has(b.kind));
  const elements = new Set(faced.flatMap(blockerElements));
  if (!elements.size) return { outlines: [], bars: [], missedBars: [], overhang: [], boxes: [] };
  const all = findingShapes(snapshot, new Set(), work, focus);
  const accepted = new Set(
    (inputs?.edits.rulings ?? [])
      .filter((ruling) => ruling.verdict === "accept")
      .map((ruling) => ruling.pair.join("|")),
  );
  const pairOf = (elementId: number) => {
    const blocker = faced.find((b) => blockerElements(b).includes(elementId));
    return blocker?.proposal?.pair ?? blocker?.closer.candidate?.pair ?? null;
  };
  const own = <T extends { elementId: number }>(parts: T[]) =>
    parts.filter((part) => elements.has(part.elementId));
  return {
    outlines: own(all.outlines),
    bars: own(all.bars),
    missedBars: own(all.missedBars),
    overhang: own(all.overhang),
    boxes: own(all.boxes).map((box) => {
      const pair = pairOf(box.elementId);
      return { ...box, ghost: !(pair && accepted.has(pair.join("|"))) };
    }),
  };
}

/** An element's centreline edges: a duct's polyline, a node's cross. */
function centrelines(snapshot: DuctSnapshot) {
  const segments = new Map(snapshot.segments.map((s) => [s.id, s.polyline]));
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n.point]));
  return (id: number): Edge[] => {
    const line = segments.get(id);
    if (line) return line.slice(1).map((q, i) => [line[i]!, q] as const);
    const point = nodes.get(id);
    return point
      ? [0, 1, 2].map(
          (axis) =>
            [
              point.map((v, k) => (k === axis ? v - CROSS : v)),
              point.map((v, k) => (k === axis ? v + CROSS : v)),
            ] as const,
        )
      : [];
  };
}

const hash = (value: unknown) => {
  let h = 0;
  for (const c of JSON.stringify(value)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
};

/** One centreline mark per blocker leg, answering its own row. */
export function centrelineLayers(snapshot: DuctSnapshot, blockers: readonly SheetBlocker[]) {
  const edgesOf = centrelines(snapshot);
  return blockers.flatMap((blocker): Layer3D[] => {
    const style = CENTRELINE.get(blocker.kind);
    const edges = style ? edgesOf(blocker.elementId) : [];
    if (!style || !edges.length) return [];
    return [
      {
        key: `sheet-leg:${blocker.id}:${hash(edges)}`,
        targets: [{ key: blocker.id, elementId: blocker.elementId }],
        findings: [blocker.id],
        build: (group) =>
          void group.add(
            markLines(edges, inkOf(style.dashed ? "ink-2" : "viz-3"), {
              weight: 1.8,
              dash: style.dashed ? { size: 0.12, gap: 0.08 } : undefined,
            }),
          ),
        frame: markFrame,
      },
    ];
  });
}

/** The worst complete path, heavy; drawn as weight and ink, which `markLines` already expresses. */
export function worstPathLayer(
  snapshot: DuctSnapshot,
  worstPathIds: ReadonlySet<number>,
): Layer3D | null {
  if (!worstPathIds.size) return null;
  const edgesOf = centrelines(snapshot);
  const edges = [...worstPathIds].flatMap(edgesOf);
  if (!edges.length) return null;
  return {
    key: `sheet-worst:${hash([...worstPathIds].sort((a, b) => a - b))}`,
    findings: [],
    targets: [],
    build: (group) => void group.add(markLines(edges, inkOf("ink"), { weight: 2.5 })),
    frame: markFrame,
  };
}

export function sheetLayers(input: SheetLayerInput): Layer3D[] {
  const shapes = blockerShapes(
    input.snapshot,
    input.work,
    input.blockers,
    input.inputs,
    input.focus,
  );
  const issues = sheetIssues(input.blockers, shapes);
  const worst = worstPathLayer(input.snapshot, input.worstPathIds);
  return [
    ...(worst ? [worst] : []),
    ...centrelineLayers(input.snapshot, input.blockers),
    ...findingLayers(shapes, issues),
    ...(input.meshes ? damageLayers(input.meshes, issues) : []),
  ];
}
