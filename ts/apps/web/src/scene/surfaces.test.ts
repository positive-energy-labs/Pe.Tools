import { expect, test } from "vite-plus/test";
import * as THREE from "three";
import { LOOK } from "./grounds";
import { routeColour, routeLines, systemPaint } from "./surfaces";
import { SceneMeshes, type Paint, type SceneInstance } from "./types";

test("same-type opened systems get distinct values in natural order; stubs and shells cannot reshuffle them", () => {
  const paints: Paint[] = [
    { tier: "subject", kind: "fresh", key: "FA 32" },
    { tier: "subject", kind: "fresh", key: "FA 24" },
    { tier: "stub", kind: "fresh", key: "FA 1" },
    { tier: "envelope", kind: "fresh", key: "FA 2" },
    { tier: "subject", kind: "supply", key: "SA 71" },
  ];
  const instances = paints.map((_, n) => ({ key: String(n) }) as SceneInstance);
  const meshes = new SceneMeshes(
    new Float32Array(),
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    instances,
  );
  const base = (i: SceneInstance) => paints[Number(i.key)];
  const paint = systemPaint(meshes, base);
  expect(instances.map((i) => paint(i)?.variant ?? 0)).toEqual([-1, 0, 0, 0, 0]);
  const colour = new THREE.Color("#1cbcd5");
  const hsl = colour.getHSL({ h: 0, s: 0, l: 0 });
  const variant = routeColour(colour, paint(instances[0]!)!, LOOK.defaults).getHSL({
    h: 0,
    s: 0,
    l: 0,
  });
  expect(variant.h).toBeCloseTo(hsl.h);
  expect(variant.s).toBeCloseTo(hsl.s);
  expect(variant.l).toBeLessThan(hsl.l);
  const fourth = routeColour(colour, { tier: "subject", variant: -2 }, LOOK.defaults).getHSL({
    h: 0,
    s: 0,
    l: 0,
  });
  expect(fourth.h).toBeCloseTo(hsl.h);
  expect(fourth.s).toBeCloseTo(hsl.s);
  expect(fourth.l).toBeGreaterThan(0);
  expect(fourth.l).toBeLessThan(variant.l);
  expect(
    systemPaint(
      new SceneMeshes(meshes.positions, meshes.bounds, [...instances].reverse()),
      base,
    )(instances[0]!)?.variant,
  ).toBe(-1);
});

test("hidden route creases use depth comparison and dashes without writing depth", () => {
  for (const hidden of [false, true]) {
    const line = routeLines([0, 0, 0, 1, 0, 0], new THREE.Color("#1cbcd5"), LOOK.defaults, hidden);
    expect(line.material.depthTest).toBe(true);
    expect(line.material.depthWrite).toBe(false);
    expect(line.material.depthFunc).toBe(hidden ? THREE.GreaterDepth : THREE.LessEqualDepth);
    expect(line.material.dashed).toBe(hidden);
    expect(line.geometry.getAttribute("instanceDistanceEnd").getX(0)).toBe(1);
    line.geometry.dispose();
    line.material.dispose();
  }
});
