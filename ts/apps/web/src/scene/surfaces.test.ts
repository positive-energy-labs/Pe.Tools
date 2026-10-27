import { expect, test } from "vite-plus/test";
import * as THREE from "three";
import { LOOK, SYSTEM_LIGHTNESS } from "./grounds";
import { toOklch } from "./oklch";
import { routeColour, routeLines, systemPaint } from "./surfaces";
import { SceneMeshes, type Paint, type SceneInstance } from "./types";

test("same-type opened systems take fixed lightness rungs in natural order; stubs and shells cannot reshuffle them", () => {
  const paints: Paint[] = [
    { tier: "subject", ink: "#1cbcd5", system: "FA 32" },
    { tier: "subject", ink: "#1cbcd5", system: "FA 24" },
    { tier: "stub", ink: "#1cbcd5", system: "FA 1" },
    { tier: "subject", ink: "#1cbcd5", system: "FA 2", surface: "shell" },
    { tier: "subject", ink: "#0569a5", system: "SA 71" },
  ];
  const instances = paints.map((_, n) => ({ key: String(n) }) as SceneInstance);
  const meshes = new SceneMeshes(
    new Float32Array(),
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    instances,
  );
  const base = (i: SceneInstance) => paints[Number(i.key)];
  const paint = systemPaint(meshes, base);
  expect(instances.map((i) => paint(i)?.variant)).toEqual([1, 0, undefined, undefined, 0]);
  const colour = new THREE.Color("#1cbcd5");
  const hue = toOklch(colour).h;
  for (const dark of [false, true])
    SYSTEM_LIGHTNESS[dark ? "dark" : "light"].forEach((L, variant) => {
      const got = toOklch(routeColour(colour, { tier: "subject", variant }, dark));
      expect(got.L).toBeCloseTo(L, 2);
      expect(got.h).toBeCloseTo(hue, 1);
    });
  expect(routeColour(colour, { tier: "subject", variant: 7 }, false).getHex()).toBe(
    routeColour(colour, { tier: "subject", variant: 2 }, false).getHex(),
  );
  expect(
    systemPaint(
      new SceneMeshes(meshes.positions, meshes.bounds, [...instances].reverse()),
      base,
    )(instances[0]!)?.variant,
  ).toBe(1);
});

test("no two lightness rungs cross at defaults, and a selection lift stays between neighbours", () => {
  for (const theme of ["light", "dark"] as const) {
    const rungs = SYSTEM_LIGHTNESS[theme];
    const legibility = rungs.map((L) => Math.abs(L - (theme === "light" ? 1 : 0)));
    legibility.forEach((v, n) => n && expect(v).toBeLessThan(legibility[n - 1]!));
    rungs.forEach(
      (L, n) =>
        n &&
        expect(Math.abs(L - rungs[n - 1]!)).toBeGreaterThanOrEqual(
          LOOK.defaults.lift.selected - 1e-9,
        ),
    );
  }
  const { hover, lit, selected } = LOOK.defaults.lift;
  expect(hover).toBeLessThan(lit);
  expect(lit).toBeLessThan(selected);
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
