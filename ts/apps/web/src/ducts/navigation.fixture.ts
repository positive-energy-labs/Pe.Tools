/** Explicit synthetic network for /ducts?demo=navigation; production pricing builds every view. */
import type { DuctClaim } from "@pe/agent-contracts";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { SCENE_FIXTURE } from "./scene.fixture";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Node["connectors"][number];

const connector = (
  index: number,
  point: number[],
  elementId: number | null,
  port = 0,
): Connector => ({
  index,
  kind: "end",
  point,
  direction: "bidirectional",
  shape: "round",
  size: '12" round',
  diameterIn: 12,
  areaFt2: Math.PI / 4,
  connectedTo: elementId === null ? null : { elementId, connector: port },
});

/** Equipment is an attachment, as in native snapshots; the shared junction feeds both supplies. */
function network(base: number, names: string[], x: number, label: string) {
  const group = `g${base + 1}`;
  const point = [x, 0, 12];
  const nodes: Node[] = [
    {
      id: base,
      kind: "equipment",
      category: "Mechanical Equipment",
      family: "Navigation fixture air mover",
      label,
      point: [x - 6, 0, 12],
      levelId: 2,
      connectors: [connector(0, [x - 4, 0, 12], base + 1)],
      facts: [{ key: "mark", text: label, unit: "", provenance: "designer-stated" }],
    },
    {
      id: base + 2,
      kind: "fitting",
      category: "Duct Fittings",
      family: "Navigation fixture shared plenum",
      label: `${label} shared plenum`,
      point,
      levelId: 2,
      groupId: group,
      systemName: names[0],
      connectors: [connector(0, point, base + 1, 1)],
      facts: [],
    },
  ];
  const segment = (
    id: number,
    start: number[],
    end: number[],
    a: Connector,
    b: Connector,
  ): Segment => ({
    id,
    kind: "duct",
    curveKind: "line",
    shape: "round",
    size: '12" round',
    diameterIn: 12,
    lengthFt: Math.hypot(...end.map((value, axis) => value - start[axis]!)),
    polyline: [start, end],
    levelId: 2,
    groupId: group,
    systemName: names[0],
    roughness: { valueFt: 0.0003, provenance: "revit-default" },
    revit: {},
    connectors: [a, b],
  });
  const segments = [
    segment(
      base + 1,
      [x - 4, 0, 12],
      point,
      connector(0, [x - 4, 0, 12], base),
      connector(1, point, base + 2),
    ),
  ];
  for (let i = 0; i < names.length * 16; i++) {
    const name = names[Math.floor(i / 16)]!;
    const terminal = base + 100 + i;
    const branch = base + 200 + i;
    const port = i + 1;
    const end = [x + 10 + Math.floor(i / 8) * 8, ((i % 8) - 3.5) * 4, 12];
    nodes[1]!.connectors.push(connector(port, point, branch));
    nodes.push({
      id: terminal,
      kind: "terminal",
      category: "Air Terminals",
      family: name.startsWith("EA") ? "Exhaust grille" : "Supply diffuser",
      label: `${name} ${String((i % 16) + 1).padStart(2, "0")}`,
      point: end,
      levelId: 2,
      groupId: group,
      systemName: name,
      connectors: [connector(0, end, branch, 1)],
      facts: [
        { key: "terminalFlow", value: 100 + i * 5, unit: "CFM", provenance: "designer-stated" },
      ],
    });
    segments.push({
      ...segment(
        branch,
        point,
        end,
        connector(0, point, base + 2, port),
        connector(1, end, terminal),
      ),
      systemName: name,
    });
  }
  // The extra open port is a deliberate shared finding, not a fabricated inbox row.
  const open = nodes[1]!.connectors.length;
  nodes[1]!.connectors.push(connector(open, point, null));
  const issue: DuctSnapshot["issues"][number] = {
    id: `open-end:${base + 2}:${open}`,
    kind: "open-end",
    elementId: base + 2,
    connector: open,
    point,
    note: `${label} shared plenum has an open fixture test port.`,
  };
  return {
    nodes,
    segments,
    issue,
    group: {
      id: group,
      rootIds: [base],
      classifications: [names[0]!.startsWith("EA") ? "Exhaust Air" : "Supply Air"],
      systemNames: names,
      terminalCount: names.length * 16,
      elementCount: nodes.length - 1 + segments.length,
      loops: 0,
      issueIds: [issue.id],
    },
  };
}

const networks = [
  network(1000, ["SA Office", "SA Lab"], 0, "AHU-1"),
  network(4000, ["EA Lab"], 70, "EF-1"),
];
const snapshot: DuctSnapshot = {
  ...SCENE_FIXTURE.snapshot,
  document: {
    title: "Navigation fixture (synthetic, native actions disabled)",
    readAt: "2026-10-23T00:00:00Z",
    elapsedMs: 0,
    networkBasedCalculations: false,
  },
  groups: networks.map((n) => n.group),
  nodes: networks.flatMap((n) => n.nodes),
  segments: networks.flatMap((n) => n.segments),
  issues: networks.map((n) => n.issue),
  flows: [],
  layers: [],
  systems: ["SA Office", "SA Lab", "EA Lab"].map((name, i) => ({
    id: 9000 + i,
    name,
    classification: name.startsWith("EA") ? "Exhaust Air" : "Supply Air",
    criticalPath: [],
    sections: [],
  })),
};

export const NAVIGATION_FIXTURE = {
  snapshot,
  subject: null,
  claims: {
    "shared-plenum": {
      title: "Shared plenum",
      state: "unproven",
      ids: [1002],
      text: "AHU-1's shared plenum serves SA Office and SA Lab; its open fixture port needs review.",
    },
  } satisfies Record<string, DuctClaim>,
  // Straight branches need no coefficient grids. Unpriced fittings remain real production findings.
  grids: {} satisfies Grids,
};
