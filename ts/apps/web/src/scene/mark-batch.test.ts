import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { expect, it } from "vite-plus/test";
import { createMarkBatch } from "./mark-batch";
import { markFrame, markLines } from "./marks";

it("batches semantic strokes, keeps transforms and dash origins, and only rebuilds changed styles", () => {
  const color = new THREE.Color(0.3, 0.2, 0.1);
  const make = () =>
    markLines(
      [
        [
          [0, 0, 0],
          [2, 0, 0],
        ],
      ],
      color,
      { dash: { size: 0.6, gap: 0.4 } },
    );
  const first = make();
  const second = make();
  second.position.set(10, 5, 0);
  const batch = createMarkBatch([first, second], () => {});
  expect(batch.sync()).toBe(true);
  expect(batch.group.children).toHaveLength(2);
  const lines = batch.group.children as LineSegments2[];
  const ink = lines.find((line) => line.material.dashed)!;
  expect(ink.geometry.getAttribute("instanceStart").count).toBe(2);
  expect(ink.geometry.getAttribute("instanceStart").getX(1)).toBe(10);
  expect(ink.geometry.getAttribute("instanceStart").getY(1)).toBe(5);
  expect(ink.geometry.getAttribute("instanceDistanceStart").getX(1)).toBe(0);
  expect(ink.geometry.getAttribute("instanceDistanceEnd").getX(1)).toBe(2);
  expect(batch.sync()).toBe(false);
  expect(first.children.every((child) => !child.visible)).toBe(true);
  markFrame(first, { seconds: 0, reducedMotion: true, state: "hover", landed: Infinity });
  expect(batch.sync()).toBe(true);
  expect(batch.group.children).toHaveLength(4);
  expect(
    (batch.group.children as LineSegments2[]).filter((line) => !line.material.depthTest),
  ).toHaveLength(2);
  batch.dispose();
  expect(batch.group.children).toHaveLength(0);
  expect(first.children.every((child) => child.visible)).toBe(true);
});

it("preserves separate semantic ray hits even though original strokes are not drawn", () => {
  const mark = markLines(
    [
      [
        [0, 0, 0],
        [2, 0, 0],
      ],
    ],
    new THREE.Color(),
  );
  const line = mark.children[1] as LineSegments2;
  line.material.resolution.set(100, 100);
  const batch = createMarkBatch([mark], () => {});
  batch.sync();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(1, 0, 10);
  camera.lookAt(1, 0, 0);
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(), camera);
  expect(ray.intersectObject(line).length).toBeGreaterThan(0);
  batch.dispose();
});
