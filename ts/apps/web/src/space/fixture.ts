/**
 * `?demo=fixture`: a synthetic room (slab, two walls, a duct run, a linked beam, a DWG import),
 * written as real PSC1 bytes and read back by the real decoder, with one answer per space op shaped
 * as the generated DTOs declare. No Revit, no host: every fact here is invented and says so.
 */
import { decodeScene, SCENE_FORMAT, type Psc1Metadata } from "#/scene/psc1";

import type { Answer } from "./manifest";

type Box = {
  id: number;
  uid: string;
  category: string;
  kind: "Solid" | "Mesh" | "Curve2D";
  source: 0 | 1;
  box: [number, number, number, number, number, number];
  focus?: boolean;
  layer?: string;
  extrusion?: { maxHeightFt: number; reasons: string[] };
  heightRole?: "None" | "Floor" | "Overhead" | "ByGeometry";
};

const HOST = "fixture:host",
  LINK = "fixture:link";
const BOXES: Box[] = [
  {
    id: 101,
    uid: "slab-101",
    category: "Floors",
    kind: "Solid",
    source: 0,
    box: [0, 0, -1, 40, 30, 0],
    heightRole: "Floor",
  },
  {
    id: 102,
    uid: "wall-102",
    category: "Walls",
    kind: "Solid",
    source: 0,
    box: [0, 0, 0, 40, 0.7, 12],
  },
  {
    id: 103,
    uid: "wall-103",
    category: "Walls",
    kind: "Solid",
    source: 0,
    box: [0, 0, 0, 0.7, 30, 12],
  },
  {
    id: 201,
    uid: "duct-201",
    category: "Ducts",
    kind: "Solid",
    source: 0,
    box: [4, 12, 9, 34, 14, 10.5],
    focus: true,
  },
  {
    id: 202,
    uid: "duct-202",
    category: "Ducts",
    kind: "Solid",
    source: 0,
    box: [32, 6, 9, 34, 12, 10.5],
    focus: true,
  },
  {
    id: 301,
    uid: "beam-301",
    category: "Structural Framing",
    kind: "Solid",
    source: 1,
    box: [0, 20, 11, 40, 21, 12],
    heightRole: "Overhead",
  },
  {
    id: 401,
    uid: "dwg-401",
    category: "Imports in Families",
    kind: "Curve2D",
    source: 0,
    box: [6, 3, 0, 20, 9, 8],
    layer: "M-DUCT",
    extrusion: {
      maxHeightFt: 8,
      reasons: ["closed loop on a mechanical layer", "capped at the level above"],
    },
    heightRole: "ByGeometry",
  },
];

/** Twelve triangles of an axis-aligned box, nine floats each. */
function boxTriangles([x0, y0, z0, x1, y1, z1]: Box["box"]): number[] {
  const c = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return faces.flatMap((f) => f.flatMap((i) => c[i]!));
}

const stamp = {
  hostDocumentKey: HOST,
  epoch: 7,
  frame: "host-internal-ft",
  builtUtc: "2026-10-21T00:00:00Z",
  sources: [
    {
      source: 0,
      documentKey: HOST,
      kind: "Host" as const,
      builtAtEpoch: 7,
      dirty: false,
      elements: 6,
      triangles: 72,
      skipped: 0,
    },
    {
      source: 1,
      documentKey: LINK,
      linkInstanceId: 900,
      kind: "RevitLink" as const,
      builtAtEpoch: 7,
      dirty: false,
      elements: 1,
      triangles: 12,
      skipped: 0,
    },
  ],
  fresh: true,
  resolved: {
    sources: ["Host", "RevitLink"] as ("Host" | "RevitLink")[],
    categories: [],
    kinds: [],
    layers: [],
    excludedElementIds: [],
  },
};
const bounds = { minX: 0, minY: 0, minZ: -1, maxX: 40, maxY: 30, maxZ: 12 };
const handleOf = (b: Box) => ({
  documentKey: b.source ? LINK : HOST,
  elementId: b.id,
  uniqueId: b.uid,
  linkInstanceId: b.source ? 900 : null,
  category: b.category,
  kind: b.kind,
  layer: b.layer ?? null,
  extrusion: b.extrusion ?? null,
  heightRole: b.heightRole ?? "None",
});

function psc1(): ArrayBuffer {
  const positions = BOXES.flatMap((b) => boxTriangles(b.box));
  const metadata: Psc1Metadata = {
    levels: {
      sources: [],
      planes: [],
      work: { nativeMilliseconds: 0, startPrivateBytes: 0, endPrivateBytes: 0 },
    },
    work: {
      broadCandidates: BOXES.length,
      extractedElements: BOXES.length,
      extractedTriangles: positions.length / 9,
      nativeMilliseconds: 0,
      peakRetainedTriangles: positions.length / 9,
      nativeGeometryCalls: 0,
      acquiredTriangles: positions.length / 9,
      contextGeometryCalls: 0,
    },
    format: SCENE_FORMAT,
    stamp,
    bounds,
    triangles: positions.length / 9,
    elements: BOXES.map((b, i) => ({
      handle: handleOf(b),
      firstVertex: i * 36,
      vertexCount: 36,
      representation: "mesh",
      bounds: {
        minX: b.box[0],
        minY: b.box[1],
        minZ: b.box[2],
        maxX: b.box[3],
        maxY: b.box[4],
        maxZ: b.box[5],
      },
      focus: !!b.focus,
    })),
    requestedElementIds: [201, 202],
    omittedElements: 0,
    completeness: {
      complete: true,
      deferredCandidates: 0,
      acquisitionLimitedElements: 0,
      limitReason: null,
    },
    sources: [
      {
        documentKey: HOST,
        linkInstanceId: null,
        sourceToHost: [],
        state: "loaded",
        name: "host",
        read: null,
      },
      {
        documentKey: LINK,
        linkInstanceId: 900,
        sourceToHost: [],
        state: "loaded",
        name: "link",
        read: null,
      },
    ],
    phase: "context",
    unavailableElements: [],
    detachedElementIds: [],
  };
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const offset = Math.ceil((8 + json.length) / 4) * 4;
  const buffer = new ArrayBuffer(offset + positions.length * 4);
  const header = new DataView(buffer);
  header.setUint32(0, 0x31435350, true);
  header.setUint32(4, json.length, true);
  new Uint8Array(buffer, 8, json.length).set(json);
  new Float32Array(buffer, offset).set(positions);
  return buffer;
}

export const FIXTURE_SCENE = decodeScene(psc1());

const searched = { docs: 2, categories: 5, candidates: 7, examined: 7, skipped: 0 };
const index = <T>(values: T[]) => {
  const names = [...new Set(values)];
  return { names, at: values.map((v) => names.indexOf(v)) };
};
const categories = index(BOXES.map((b) => b.category));
const kinds = index(BOXES.map((b) => b.kind));
const roles = index(BOXES.map((b) => b.heightRole ?? "None"));
const layers = index(BOXES.flatMap((b) => (b.layer ? [b.layer] : [])));

export const FIXTURE_ANSWERS: {
  status: Answer<"revit.detail.space-status">;
  rows: Answer<"revit.detail.space-rows">;
  tree: Answer<"revit.detail.space-tree">;
  slice: Answer<"revit.detail.space-slice">;
  probe: Answer<"revit.detail.space-probe">;
  sweep: Answer<"revit.detail.space-sweep">;
} = {
  status: {
    request: {},
    response: {
      stamp,
      built: true,
      pendingIds: 0,
      categories: [],
      levels: [
        { name: "Level 1", elevationFt: 0 },
        { name: "Level 2", elevationFt: 12 },
      ],
      bounds,
      ms: 1,
    },
  },
  rows: {
    request: {},
    response: {
      stamp,
      searched,
      categories: categories.names,
      kinds: kinds.names,
      layers: layers.names,
      heightRoles: roles.names,
      source: BOXES.map((b) => b.source),
      elementId: BOXES.map((b) => b.id),
      category: categories.at,
      kind: kinds.at,
      layer: BOXES.map((b) => (b.layer ? layers.names.indexOf(b.layer) : -1)),
      heightRole: roles.at,
      triangles: BOXES.map(() => 12),
      extrusionFt: BOXES.map((b) => b.extrusion?.maxHeightFt ?? 0),
      box: BOXES.flatMap((b) => b.box),
      ms: 1,
    },
  },
  tree: {
    request: { source: 0, maxDepth: 2 },
    response: {
      stamp,
      source: 0,
      maxDepth: 2,
      nodes: [
        { index: 0, depth: 0, leaf: false, triangles: 72, box: [0, 0, -1, 40, 30, 12] },
        { index: 1, depth: 1, leaf: true, triangles: 36, box: [0, 0, -1, 20, 30, 12] },
        { index: 2, depth: 1, leaf: true, triangles: 36, box: [20, 0, -1, 40, 30, 12] },
      ],
      ms: 1,
    },
  },
  slice: {
    request: { z0: 9, z1: 10.5 },
    response: {
      stamp,
      searched,
      elements: BOXES.filter((b) => b.box[2] <= 10.5 && b.box[5] >= 9 && b.source === 0).map(
        (b) => ({
          handle: handleOf(b),
          pieces: [
            [b.box[0], b.box[1], b.box[3], b.box[1], b.box[3], b.box[4], b.box[0], b.box[4]],
          ],
        }),
      ),
      pieces: 4,
      total: 4,
      truncated: false,
      ms: 1,
    },
  },
  probe: {
    request: { at: [20, 13, 5] },
    response: {
      stamp,
      searched,
      floor: { handle: handleOf(BOXES[0]!), distanceFt: 5, z: 0 },
      ceiling: { handle: handleOf(BOXES[3]!), distanceFt: 4, z: 9 },
      maxDistanceFt: 200,
      ms: 1,
      purpose: "Obstructions",
    },
  },
  sweep: {
    request: {
      polyline: [
        [4, 25, 10],
        [20, 25, 10],
        [20, 20.5, 11.5],
      ],
      widthFt: 1.5,
      heightFt: 1,
      clearanceFt: 0.5,
    },
    response: {
      stamp,
      searched,
      segments: [
        { index: 0, verdict: "CLEAR", minGapFt: 3.2, nearest: null, closestPoint: null },
        {
          index: 1,
          verdict: "HIT",
          minGapFt: 0,
          nearest: handleOf(BOXES[5]!),
          closestPoint: [20, 21, 11.5],
        },
      ],
      ms: 1,
    },
  },
};
