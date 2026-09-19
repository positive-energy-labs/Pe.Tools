// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { fitFrame, type Point2 } from "#/lib/affine-frame";
import { PlanImageLayer, type TakeoffPlanImage } from "#/takeoff/level-plan";

afterEach(cleanup);

// A crop rotated 30°: Revit's registration places the image's top-left, top-right and
// bottom-left pixel corners in model feet.
const cos = Math.cos(Math.PI / 6);
const sin = Math.sin(Math.PI / 6);
const plan: TakeoffPlanImage = {
  href: "data:image/png;base64,iVBORw0KGgo=",
  registration: {
    width: 400,
    height: 200,
    topLeft: [10, 60],
    topRight: [10 + 40 * cos, 60 + 40 * sin],
    bottomLeft: [10 + 20 * sin, 60 - 20 * cos],
  },
};

test("the plan image layer mounts under the zones, placed by the registration in the zones' frame", () => {
  const frame = fitFrame(
    { minX: 0, minY: 0, maxX: 80, maxY: 90 },
    { width: 800, height: 900 },
    { padding: 24, yAxis: "up" },
  );
  const { container } = render(
    <svg>
      <PlanImageLayer plan={plan} frame={frame} />
    </svg>,
  );
  const image = container.querySelector("image[data-layer='plan-image']")!;
  expect(image.getAttribute("href")).toBe(plan.href);
  expect(image.getAttribute("width")).toBe("400");
  const [a, b, c, d, e, f] = image
    .getAttribute("transform")!
    .replace(/^matrix\(|\)$/g, "")
    .split(",")
    .map(Number);
  const pixel = ([u, v]: Point2): Point2 => [a! * u + c! * v + e!, b! * u + d! * v + f!];
  const close = (got: Point2, want: Point2) => {
    expect(got[0]).toBeCloseTo(want[0], 6);
    expect(got[1]).toBeCloseTo(want[1], 6);
  };
  // The image's corners land exactly where the zone frame draws those model points.
  const { registration: r } = plan;
  close(pixel([0, 0]), frame.toViewport(r.topLeft));
  close(pixel([r.width, 0]), frame.toViewport(r.topRight));
  close(pixel([0, r.height]), frame.toViewport(r.bottomLeft));
});
