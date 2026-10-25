import { expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { layoutCaptions, pathOf } from "../ducts/subject-labels";
import { frame } from "./orbit";
import { sectionProject, viewportProject, type Project } from "./projection";
import { ContinuationMarks } from "./continuations";
import { SceneMeshes } from "./types";

it("frames a long narrow subject in portrait and landscape with both camera projections", () => {
  const bounds = { minX: -40, maxX: 40, minY: -1, maxY: 1, minZ: 0, maxZ: 4 };
  for (const aspect of [0.4, 1.7])
    for (const projection of ["parallel", "perspective"] as const) {
      const size = { width: 600 * aspect, height: 600 };
      const pose = frame(bounds, bounds, { yaw: 225, elev: 32, projection }, aspect);
      const project = viewportProject(pose, bounds, size);
      const points = [bounds.minX, bounds.maxX].flatMap((x) =>
        [bounds.minY, bounds.maxY].flatMap((y) =>
          [bounds.minZ, bounds.maxZ].map((z) => project([x, y, z])!),
        ),
      );
      for (const p of points) {
        expect(p[0]).toBeGreaterThanOrEqual(size.width * 0.08);
        expect(p[0]).toBeLessThanOrEqual(size.width * 0.92);
        expect(p[1]).toBeGreaterThanOrEqual(size.height * 0.08);
        expect(p[1]).toBeLessThanOrEqual(size.height * 0.92);
      }
      const fill = Math.max(
        (Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]))) / size.width,
        (Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]))) / size.height,
      );
      expect(fill).toBeGreaterThan(projection === "parallel" ? 0.81 : 0.6);
    }
});

it("retains nine crowded continuation captions, separates their boxes, and spaces joined names", () => {
  const placed = layoutCaptions(
    Array.from({ length: 9 }, (_, i) => ({
      key: String(i),
      text: i === 0 ? "SA 29,RA 1,SS 24" : `FA ${i}`,
      stub: true,
      x: 200 + i,
      y: 150 + i,
    })),
    { x: 0, y: 0, width: 600, height: 400 },
  );
  expect(placed).toHaveLength(9);
  expect(placed[0]!.text).toBe("SA 29, RA 1, SS 24");
  for (const [i, a] of placed.entries())
    for (const b of placed.slice(i + 1)) {
      expect(
        a.x < b.x + b.text.length * 7 && b.x < a.x + a.text.length * 7 && Math.abs(a.y - b.y) < 16,
      ).toBe(false);
    }
  expect(placed.every((p) => p.anchor)).toBe(true);
});

it("clips anchors, crossing lines and continuation ticks with the same section planes", () => {
  const raw: Project = (p) => [p[0]!, p[1]!];
  for (const section of [
    { kind: "plane" as const, axis: "x" as const, offset: 0, keep: "above" as const },
    { kind: "box" as const, bounds: { minX: 0, maxX: 10, minY: -5, maxY: 5, minZ: -5, maxZ: 5 } },
  ]) {
    const project = sectionProject(raw, section);
    expect(project([-1, 0, 0])).toBeNull();
    expect(project([1, 0, 0])).toEqual([1, 0]);
    expect(
      pathOf(
        [
          [-1, 0, 0],
          [1, 0, 0],
        ],
        project,
      ),
    ).toBe("M0.0 0.0L1.0 0.0");
    const meshes = new SceneMeshes(
      new Float32Array(),
      section.kind === "box"
        ? section.bounds
        : { minX: -10, maxX: 10, minY: -5, maxY: 5, minZ: -5, maxZ: 5 },
      [],
      new Map([
        [1, [{ from: [-2, 0, 0], at: [-1, 0, 0] }]],
        [2, [{ from: [1, 0, 0], at: [2, 0, 0] }]],
      ]),
    );
    const svg = renderToStaticMarkup(<ContinuationMarks meshes={meshes} project={project} />);
    expect(svg).not.toContain('data-continuation-end="1"');
    expect(svg).toContain('data-continuation-end="2"');
  }
});
