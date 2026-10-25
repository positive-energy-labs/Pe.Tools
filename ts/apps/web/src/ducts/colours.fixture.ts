/** Explicit no-Revit mesh fixture for /ducts?demo=colours. Geometry and names are synthetic. */
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { SceneMeshes, type SceneInstance } from "#/scene/types";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";

const kinds = [
  ["SA 1", "SupplyAir"],
  ["RA 1", "ReturnAir"],
  ["EX 1", "ExhaustAir"],
  ["FA 1", "SupplyAir"],
  ["Unclassified", ""],
] as const;
const base = NAVIGATION_FIXTURE.snapshot;
const equipment = base.nodes.find((n) => n.kind === "equipment")!;
const terminal = base.nodes.find((n) => n.kind === "terminal")!;
const segment = base.segments[0]!;
const port = (point: number[], peer: number, connector: number, index = 0) => ({
  ...segment.connectors[0]!,
  index,
  point,
  connectedTo: { elementId: peer, connector },
});
const snapshot: DuctSnapshot = {
  ...base,
  document: {
    ...base.document,
    title: "Firm colours fixture (synthetic; native actions disabled)",
  },
  nodes: kinds.flatMap(([name, classification], i) => {
    const id = 100 + i * 10,
      y = i * 10;
    return [
      {
        ...equipment,
        id,
        point: [2, y, 0],
        systemName: name,
        classification,
        facts: [{ key: "mark", text: name, unit: "", provenance: "designer-stated" as const }],
        connectors: [port([4, y, 0], id + 1, 0)],
      },
      {
        ...terminal,
        id: id + 2,
        groupId: `g${id + 1}`,
        point: [50, y, 0],
        systemName: name,
        classification,
        connectors: [port([48, y, 0], id + 1, 1)],
      },
    ];
  }),
  segments: kinds.map(([name, classification], i) => {
    const id = 101 + i * 10,
      y = i * 10;
    return {
      ...segment,
      id,
      groupId: `g${id}`,
      systemName: name,
      classification,
      lengthFt: 44,
      polyline: [
        [4, y, 0],
        [48, y, 0],
      ],
      connectors: [port([4, y, 0], id - 1, 0), port([48, y, 0], id + 1, 0, 1)],
    };
  }),
  systems: kinds.map(([name, classification], i) => ({
    id: 9000 + i,
    name,
    classification,
    criticalPath: [],
    sections: [],
  })),
  groups: kinds.map(([name, classification], i) => ({
    id: `g${101 + i * 10}`,
    rootIds: [100 + i * 10],
    classifications: [classification],
    systemNames: [name],
    terminalCount: 1,
    elementCount: 2,
    loops: 0,
    issueIds: [],
  })),
  issues: [],
  flows: [],
};

const vertices: number[] = [];
const instances: SceneInstance[] = [];
for (const [i, duct] of snapshot.segments.entries()) {
  const y = i * 10;
  const corners = [
    [4, y - 2, -2],
    [48, y - 2, -2],
    [48, y + 2, -2],
    [4, y + 2, -2],
    [4, y - 2, 2],
    [48, y - 2, 2],
    [48, y + 2, 2],
    [4, y + 2, 2],
  ];
  const firstVertex = vertices.length / 3;
  for (const face of [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ])
    for (const index of [face[0]!, face[1]!, face[2]!, face[0]!, face[2]!, face[3]!])
      vertices.push(...corners[index]!);
  instances.push({
    key: `colour-${duct.id}`,
    revitId: duct.id,
    documentKey: "fixture:colours",
    linkInstanceId: null,
    uniqueId: `colour-${duct.id}`,
    category: "Ducts",
    categoryId: null,
    focus: true,
    firstVertex,
    vertexCount: vertices.length / 3 - firstVertex,
  });
}

export const COLOURS_FIXTURE = {
  snapshot,
  subject: null,
  claims: {},
  grids: {},
  meshes: new SceneMeshes(
    new Float32Array(vertices),
    { minX: 0, maxX: 52, minY: -3, maxY: 43, minZ: -3, maxZ: 3 },
    instances,
  ),
};
