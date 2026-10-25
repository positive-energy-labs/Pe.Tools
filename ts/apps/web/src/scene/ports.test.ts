import { expect, it } from "vite-plus/test";
import * as THREE from "three";
import { equipmentPaint, equipmentPorts } from "../ducts/paint";
import type { Scene } from "../ducts/scene";
import { LOOK } from "./grounds";
import { portLayer, portSegments } from "./ports";
import { sectionContains } from "./section";
import { SceneMeshes, type LayerFrame, type PaintOf, type SceneInstance } from "./types";
import { shellEdges, surfaceAlpha } from "./surfaces";

const instance = (id: number, category = "not a duct category"): SceneInstance => ({
  key: String(id),
  revitId: id,
  documentKey: "doc",
  linkInstanceId: null,
  uniqueId: String(id),
  categoryId: null,
  category,
  focus: true,
  firstVertex: 0,
  vertexCount: 3,
});
const meshes = new SceneMeshes(
  new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
  [instance(1), instance(2), instance(3), instance(4, "equipment-like name")],
);
const connector = (index: number, id?: number) => ({
  index,
  kind: "end",
  point: [0, 0, 0],
  facing: [0, 0, 1],
  widthAxis: [1, 0, 0],
  shape: "rectangular" as const,
  size: "12x24",
  widthIn: 12,
  heightIn: 24,
  direction: "out",
  connectedTo: id ? { elementId: id, connector: 7 } : null,
});
const scene: Pick<Scene, "nodes"> = {
  nodes: [
    {
      node: {
        id: 1,
        kind: "equipment",
        category: "anything",
        point: [0, 0, 0],
        connectors: [connector(0, 2), connector(1, 3), connector(2), connector(3, 99)],
        facts: [],
      },
      issues: [],
    },
  ],
};
const graphOf = (s: Pick<Scene, "nodes">) => ({
  nodes: s.nodes.map(({ node }) => node),
  segments: [],
});
const base: PaintOf = (i) => ({
  tier: i.revitId === 3 ? "context" : i.revitId === 2 ? "stub" : "subject",
  ink: "#12aabb",
});

it("uses typed equipment identity and admits only explicit references to drawn subject/stub routes", () => {
  const paint = equipmentPaint(graphOf(scene), base);
  expect(paint(meshes.instances[0]!)?.surface).toBe("shell");
  expect(paint(meshes.instances[3]!)?.surface).toBeUndefined();
  expect(paint({ ...instance(88), categoryId: -2001140 })?.surface).toBe("shell");
  const ports = equipmentPorts(graphOf(scene), meshes, paint);
  expect(ports.map((p) => p.key)).toEqual(["1:0>2:7"]);
  expect(ports[0]).toMatchObject({
    owner: "1",
    route: "2",
    widthFt: 1,
    heightFt: 2,
    paint: { tier: "stub", ink: "#12aabb" },
  });
  expect(equipmentPorts(graphOf(scene), meshes, () => ({ tier: "context" }))).toEqual([]);
});

it("uses retained equipment category metadata only for shell treatment when numeric identity is absent", () => {
  const graph = { nodes: [] };
  const paint = equipmentPaint(graph, base);
  expect(paint(instance(99, "Mechanical Equipment"))?.surface).toBe("shell");
  expect(paint({ ...instance(99), categoryId: -2001140 })?.surface).toBe("shell");
  expect(
    paint({ ...instance(99, "Mechanical Equipment"), categoryId: -1 })?.surface,
  ).toBeUndefined();
  expect(paint(instance(99, "Mechanical Equipment copy"))?.surface).toBeUndefined();
  expect(equipmentPorts({ nodes: [], segments: [] }, meshes, paint)).toEqual([]);
});

it("refuses missing/invalid connector frames and equipment-to-equipment paths", () => {
  const other: Scene["nodes"][number] = {
    node: { ...scene.nodes[0]!.node, id: 2, connectors: [] },
    issues: [],
  };
  expect(equipmentPorts(graphOf({ nodes: [...scene.nodes, other] }), meshes, base)).toEqual([]);
  for (const facing of [null, [0, 0, 0], [NaN, 0, 1]]) {
    const invalid = {
      nodes: [
        {
          ...scene.nodes[0]!,
          node: { ...scene.nodes[0]!.node, connectors: [{ ...connector(0, 2), facing }] },
        },
      ],
    };
    expect(equipmentPorts(graphOf(invalid), meshes, base)).toEqual([]);
  }
});

it("removes the entire port when its anchor or either drawn instance is clipped/hidden", () => {
  const ports = equipmentPorts(graphOf(scene), meshes, base),
    layer = portLayer(ports),
    group = new THREE.Group();
  layer.build(group);
  const at: LayerFrame = {
    seconds: 0,
    reducedMotion: true,
    state: "rest",
    landed: Infinity,
    contains: (p) => sectionContains({ kind: "plane", axis: "x", offset: 0.1, keep: "above" }, p),
  };
  layer.frame!(group, at);
  expect(group.children[0]!.visible).toBe(false);
  layer.frame!(group, { ...at, contains: () => true, shown: (key) => key !== "2" });
  expect(group.children[0]!.visible).toBe(false);
  layer.frame!(group, { ...at, contains: () => true, shown: () => true });
  expect(group.children[0]!.visible).toBe(true);
  const line = group.children[0] as import("three/addons/lines/LineSegments2.js").LineSegments2;
  const oldGeometry = line.geometry;
  let disposed = false;
  oldGeometry.addEventListener("dispose", () => {
    disposed = true;
  });
  layer.frame!(group, {
    ...at,
    look: { ...LOOK.defaults, ports: { ...LOOK.defaults.ports, tickFt: 1, width: 3 } },
  });
  expect(disposed).toBe(true);
  expect(line.geometry).not.toBe(oldGeometry);
  expect(line.material.linewidth).toBe(3);
  line.geometry.dispose();
  line.material.dispose();
});

it("keeps the connector ring in its frame and encodes envelopes independently of stub/subject fill", () => {
  const port = equipmentPorts(graphOf(scene), meshes, base)[0]!;
  const positions = portSegments(port, LOOK.defaults);
  expect(positions.slice(0, 6)).toEqual([-0.5, -1, 0, 0.5, -1, 0]);
  expect(positions.slice(-3)).toEqual([0, 0, LOOK.defaults.ports.tickFt]);
  expect(surfaceAlpha({ tier: "subject", surface: "shell" }, LOOK.defaults)).toBe(
    1 + LOOK.defaults.shell.opacity,
  );
  expect(surfaceAlpha({ tier: "stub" }, LOOK.defaults)).toBeLessThan(0);
  expect(surfaceAlpha({ tier: "context", surface: "shell" }, LOOK.defaults)).toBe(0);
  const edges = shellEdges(meshes);
  expect(edges(meshes.instances[0]!, 35)).toBe(edges(meshes.instances[0]!, 35));
});

it("unions route-only references without duplicates and leaves absent equipment ports unknown", () => {
  const equipment = { ...scene.nodes[0]!.node, connectors: [connector(0), connector(1, 3)] };
  const route = {
    ...equipment,
    id: 2,
    kind: "fitting" as const,
    connectors: [{ ...connector(7, 1), connectedTo: { elementId: 1, connector: 0 } }],
  };
  const graph = { nodes: [equipment, route], segments: [] };
  const ports = equipmentPorts(graph, meshes, base);
  expect(ports.map((p) => p.key)).toEqual(["1:0>2:7"]);
  const reciprocal = { ...equipment, connectors: [connector(0, 2)] };
  expect(equipmentPorts({ ...graph, nodes: [reciprocal, route] }, meshes, base)).toHaveLength(1);
  expect(equipmentPorts({ nodes: [route], segments: [] }, meshes, base)).toEqual([]);
});
