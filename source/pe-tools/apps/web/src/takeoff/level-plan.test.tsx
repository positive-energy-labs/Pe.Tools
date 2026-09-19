// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { fitFrame, type Point2 } from "#/lib/affine-frame";
import { LevelPlan, PlanImageLayer, type TakeoffPlanImage } from "#/takeoff/level-plan";
import { PLAN_REFUSAL, planOf, planView } from "#/takeoff/plan-image";
import { mockModel } from "#/takeoff/proto/mock";
import { projectMockModel } from "#/takeoff/proto/project-model";

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

/* ── 4h: the view-image response is the source ─────────────────────────────────────────── */

const world = projectMockModel(mockModel());
const lane = world.lanes[0]!;
const zones = world.zones.filter((z) => z.zone.lane.label === lane.label);
const levelPlan = (props: Partial<React.ComponentProps<typeof LevelPlan>>) =>
  render(
    <LevelPlan
      zones={zones}
      stageFilter={null}
      selectedKey={null}
      cursor={null}
      stateOf={() => "unreviewed"}
      onSelectZone={() => {}}
      onHover={() => {}}
      onCursor={() => {}}
      onClear={() => {}}
      {...props}
    />,
  );
const response = (extra: Record<string, unknown>) =>
  ({
    view: { kind: "View", documentKey: "d", label: lane.view },
    filePath: "C:Temppe-view-capturesplan.png",
    byteSize: 10,
    pixelSize: 400,
    ...extra,
  }) as never;

test("a view-image response with imageUrl mounts the plan under the zones, in the zones' frame", () => {
  const sha = "a".repeat(64);
  const got = planOf(
    response({
      imageUrl: `/view-image/${sha}.png`,
      registration: {
        ...plan.registration,
        imageSha256: sha,
        topLeft: [...plan.registration.topLeft],
        topRight: [...plan.registration.topRight],
        bottomLeft: [...plan.registration.bottomLeft],
      },
      registrationRefusal: null,
    }),
  );
  if (!("plan" in got)) throw Error("expected a plan");
  const { container } = levelPlan({ plan: got.plan });
  const image = container.querySelector("svg image[data-layer='plan-image']")!;
  // Host-relative, on the base host calls use.
  expect(image.getAttribute("href")).toBe(`/view-image/${sha}.png`);
  expect(image.getAttribute("transform")).toMatch(/^matrix\(/);
  // Under the zones: the layer precedes every zone group in paint order.
  const svg = container.querySelector("svg")!;
  expect([...svg.children].indexOf(image)).toBeLessThan(
    [...svg.children].findIndex((node) => node.tagName === "g"),
  );
  expect(container.textContent).not.toContain("no plan image");
});

test("each registration refusal is said by name in the plan area, and no image is drawn", () => {
  for (const name of ["NoCrop", "NoImage", "DegenerateCrop", "AspectDisagrees"] as const) {
    const got = planOf(response({ registration: null, imageUrl: null, registrationRefusal: name }));
    if (!("refusal" in got)) throw Error("expected a refusal");
    const { container, unmount } = levelPlan({ planRefusal: got.refusal });
    expect(container.textContent).toContain(`no plan image · ${name}`);
    expect(container.textContent).toContain(PLAN_REFUSAL[name]);
    expect(container.querySelector("image")).toBe(null);
    unmount();
  }
});

test("a response that pairs neither half, or names no reason, is refused, not drawn as nothing", () => {
  expect(() => planOf(response({ registration: null, imageUrl: "/view-image/x.png" }))).toThrow();
  expect(() => planOf(response({ registration: null, imageUrl: null }))).toThrow();
});

/* ── 23: the image is the chosen view's own, never the first lane with the level's label ── */

test("two lanes on one level: the plan image follows the chosen view, not the first label match", () => {
  const lanes = [
    { view: "Mechanical Plan - Lower Level", label: "Level 1/Main Level" },
    { view: "Mechanical Zoning Plan - Lower Level", label: "Level 1/Main Level" },
  ];
  expect(planView(lanes, ["Mechanical Zoning Plan - Lower Level"], "Level 1/Main Level")).toBe(
    "Mechanical Zoning Plan - Lower Level",
  );
  // A level with no chosen view on it draws no image: a label never picks a view.
  expect(planView(lanes, [], "Level 1/Main Level")).toBeUndefined();
  expect(planView(lanes, ["Other"], "Level 1/Main Level")).toBeUndefined();
});
