import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { expect, test } from "vite-plus/test";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { chain, lanes, segments, strandLayers, type Strand } from "./strands";
import type { LayerFrame } from "./types";

const lines = [
  // e:1 drawn with flow, e:2 drawn against it, e:3 a fitting's one point, e:4 against again.
  {
    key: "e:1",
    points: [
      [0, 0, 0],
      [4, 0, 0],
    ],
  },
  {
    key: "e:2",
    points: [
      [9, 0, 0],
      [5, 0, 0],
    ],
  },
  { key: "e:3", points: [[10, 0, 0]] },
  {
    key: "e:4",
    points: [
      [10, 6, 0],
      [10, 1, 0],
    ],
  },
] as const satisfies readonly { key: SubjectKey; points: readonly (readonly number[])[] }[];
const pointsOf = (key: SubjectKey) => lines.find((line) => line.key === key)?.points;

test("a chain orients each element to continue the last, in path order", () => {
  const links = chain(["e:1", "e:2", "e:3", "e:4"], pointsOf);
  expect(links.map((l) => l.points)).toEqual([
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [5, 0, 0],
      [9, 0, 0],
    ],
    [[10, 0, 0]],
    [
      [10, 1, 0],
      [10, 6, 0],
    ],
  ]);
  expect(links.map((l) => l.reversed)).toEqual([false, true, false, true]);
  // Flow runs the other way: the first element orients toward its successor.
  expect(chain(["e:2", "e:1"], pointsOf)[0]!.points[0]).toEqual([9, 0, 0]);
  // An element without a centreline is skipped and the chain bridges it.
  expect(chain(["e:1", "e:9", "e:2"], pointsOf).map((l) => l.element)).toEqual(["e:1", "e:2"]);
});

test("shared elements give distinct lanes, ordered by strand order all along", () => {
  const strands: Strand[] = [
    { key: "run:a", path: ["e:1", "e:2", "e:3"] },
    { key: "run:b", path: ["e:2", "e:3", "e:4"] },
    { key: "run:c", path: ["e:3", "e:4"], heavy: true },
  ];
  const chains = strands.map((s) => chain(s.path, pointsOf));
  const [a, b, c] = lanes(strands, chains);
  expect(a!.get("e:1")).toBe(0);
  expect(a!.get("e:2")).toBeLessThan(b!.get("e:2")!);
  const on3 = [a!.get("e:3")!, b!.get("e:3")!, c!.get("e:3")!];
  expect(new Set(on3).size).toBe(3);
  // No swap: a stays on the same side of b from e:2 into e:3, and b of c from e:3 into e:4.
  expect(on3[0]).toBeLessThan(on3[1]);
  expect(b!.get("e:4")).toBeLessThan(c!.get("e:4")!);
  // The heavy lane is wider: its centre sits further from b's than a's does.
  expect(on3[2] - on3[1]).toBeGreaterThan(on3[1] - on3[0]);
  // A strand crossing a shared element the other way keeps its own lane: lanes sit on opposite
  // sides of the centreline, so equal offsets relative to opposite travel are opposite sides.
  const back: Strand[] = [strands[0]!, { key: "run:d", path: ["e:2", "e:1"] }];
  const [a2, d] = lanes(
    back,
    back.map((s) => chain(s.path, pointsOf)),
  );
  expect(a2!.get("e:1")).toBe(-2.5);
  expect(d!.get("e:1")).toBe(-2.5);
});

test("segments ramp the lane across a gap, each half its element's, and drop zero lengths", () => {
  const links = chain(["e:1", "e:2"], pointsOf);
  const parts = segments(
    links,
    new Map<SubjectKey, number>([
      ["e:1", -2],
      ["e:2", 4],
    ]),
  );
  expect(parts.map((s) => [s.element, s.lane])).toEqual([
    ["e:1", [-2, -2]],
    ["e:1", [-2, 1]],
    ["e:2", [1, 4]],
    ["e:2", [4, 4]],
  ]);
  expect(parts[1]!.to).toEqual([4.5, 0, 0]);
  const touching = chain(["e:2", "e:3"], pointsOf);
  expect(touching.length).toBe(2);
  expect(segments(touching, new Map()).length).toBe(3);
});

const frame = (state: LayerFrame["state"], reducedMotion = false): LayerFrame => ({
  seconds: 3.3,
  reducedMotion,
  state,
  landed: Infinity,
  ink: new THREE.Color(0.1, 0.1, 0.1),
});

test("a pick meets the nearer lane, so a bundled strand selects its own subject", () => {
  const strands: Strand[] = [
    { key: "run:a", path: ["e:1"] },
    { key: "run:b", path: ["e:1"] },
  ];
  const built = strandLayers(strands, lines, new Set());
  expect(built.map((l) => l.targets)).toEqual([
    [{ key: "run:a", elementId: 1, subject: true }],
    [{ key: "run:b", elementId: 1, subject: true }],
  ]);
  const groups = built.map((layer) => {
    const group = new THREE.Group();
    layer.build(group);
    group.traverse((o) => {
      if (o instanceof LineSegments2) o.material.resolution.set(800, 600);
    });
    group.updateMatrixWorld(true);
    return group;
  });
  // Looking straight down: 40 px per foot. run:b's lane (pitch 5 px) sits 2.5 px right of +x, i.e.
  // below the centreline on screen.
  const camera = new THREE.OrthographicCamera(-10, 10, 7.5, -7.5, 0.1, 100);
  camera.position.set(2, 0, 50);
  camera.lookAt(2, 0, 0);
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line2 = { threshold: 12 };
  const nearest = (yPx: number) => {
    raycaster.setFromCamera(new THREE.Vector2(0, yPx / 300), camera);
    const hits = groups.flatMap((g, i) =>
      raycaster.intersectObject(g, true).map((hit) => ({ hit, key: strands[i]!.key })),
    );
    hits.sort((x, y) => x.hit.distance - y.hit.distance);
    return hits[0]?.key ?? null;
  };
  expect(nearest(-2.5)).toBe("run:b");
  expect(nearest(2.5)).toBe("run:a");
  expect(nearest(60)).toBeNull();
});

test("only the heavy, hovered or selected strand flows; reduced motion holds it still; over is alarm", () => {
  const built = strandLayers(
    [
      { key: "run:a", path: ["e:1", "e:2"] },
      { key: "run:h", path: ["e:1"], heavy: true },
    ],
    lines,
    new Set(["e:2"]),
  );
  const [plain, heavy] = built.map((layer) => {
    const group = new THREE.Group();
    layer.build(group);
    return { layer, group };
  });
  const flow = (g: THREE.Group) => g.children.find((o) => o.userData.flow) as LineSegments2;
  expect(plain!.layer.frame!(plain!.group, frame("rest"))).toBe(false);
  expect(flow(plain!.group).visible).toBe(false);
  expect(plain!.layer.frame!(plain!.group, frame("hover"))).toBe(true);
  expect(plain!.layer.frame!(plain!.group, frame("focus"))).toBe(true);
  expect(heavy!.layer.frame!(heavy!.group, frame("rest"))).toBe(true);
  expect(flow(heavy!.group).material.dashOffset).not.toBe(0);
  expect(heavy!.layer.frame!(heavy!.group, frame("rest", true))).toBe(false);
  expect(flow(heavy!.group).visible).toBe(true);
  expect(flow(heavy!.group).material.dashOffset).toBe(0);
  const over = (plain!.group.children[0] as LineSegments2).geometry.getAttribute("instanceOver");
  expect(Array.from(over.array)).toEqual([0, 0, 1, 1]);
});
