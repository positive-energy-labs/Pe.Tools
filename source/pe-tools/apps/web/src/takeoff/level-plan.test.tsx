// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { contentViewport, fitFrame, type Point2 } from "#/lib/affine-frame";
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
  expect(planView(lanes, ["Mechanical Zoning Plan - Lower Level"], "Level 1/Main Level", [])).toBe(
    "Mechanical Zoning Plan - Lower Level",
  );
  // A level with no chosen view on it draws no image: a label never picks a view.
  expect(planView(lanes, [], "Level 1/Main Level", [])).toBeUndefined();
  expect(planView(lanes, ["Other"], "Level 1/Main Level", [])).toBeUndefined();
});

/* ── 31: the image is the drawn zones' own view (zone.lane.view), never a level-label neighbour ── */

test("two views on one level, zones owned by one: the image is the owner's, not the chosen view's", () => {
  const level = "Level 1/Main Level";
  const guestHouse = "Mechanical Zoning Plan - Main Lvl Guest House Controls";
  const poolHouse = "Mechanical Zoning Plan - Main Lvl Pool House Controls";
  const lanes = [
    { view: poolHouse, label: level },
    { view: guestHouse, label: level },
  ];
  // E/F are Guest House's own regions; the person chose Pool House, which shares the label.
  expect(planView(lanes, [poolHouse], level, [guestHouse, guestHouse])).toBe(guestHouse);
  expect(planView(lanes, [], level, [guestHouse])).toBe(guestHouse);
  // Zones of two owners: no one view owns them all, and the web cannot know "Inside" yet (ownerCrop).
  expect(planView(lanes, [poolHouse], level, [guestHouse, poolHouse])).toBeUndefined();
  // No zones drawn: the chosen view stands.
  expect(planView(lanes, [poolHouse], level, [])).toBe(poolHouse);
});

/* ── 29: the Guest House crop (45°) on projectA, HOLD 5 leg B, drawn outside the plan ──────── */

// `vi-GuestHouse.out.txt`: the registration Revit returned for "Main Lvl Guest House Controls".
const GUEST_HOUSE: TakeoffPlanImage["registration"] = {
  width: 1500,
  height: 780,
  topLeft: [494.45282510569484, 799.0979518151169],
  topRight: [582.1340659728313, 886.7791926822446],
  bottomLeft: [540.0612124922252, 753.489564428582],
};
// `geom-gh-on.json`: the six zone paths' boxes in the page's viewBox (0..217.96 x 0..167.63), and
// the matrix the page put on the image. The level plan's frame is scale 1 (contentViewport), so the
// zones' model bounds are the viewBox less its 3% padding: x 232.58..438.20, y 570.90..726.19 ft.
const DRAWN_MATRIX = [
  0.058454160578090976, -0.05845416057808514, 0.05847229152119276, 0.058472291521198594,
  268.0446759374381, -66.73636138527343,
];
const ZONE_BOXES_PX = [
  [57, 102, 107, 161],
  [64, 50, 120, 116],
  [144, 6, 212, 67],
  [153, 57, 184, 84],
  [6, 114, 42, 148],
  [101, 9, 163, 68],
] as const;
const ZONE_BOUNDS = { minX: 232.5771, minY: 570.9002, maxX: 438.2021, maxY: 726.1925 };

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const boxOf = (points: readonly Point2[]): Box => ({
  minX: Math.min(...points.map((p) => p[0])),
  minY: Math.min(...points.map((p) => p[1])),
  maxX: Math.max(...points.map((p) => p[0])),
  maxY: Math.max(...points.map((p) => p[1])),
});
const overlaps = (a: Box, b: Box) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
/** The image's four corners as the layer draws them, in the plan's viewBox. */
function drawnCorners(registration: TakeoffPlanImage["registration"], bounds: Box) {
  const { viewport, padding } = contentViewport(bounds, 0.03);
  const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });
  const { container, unmount } = render(
    <svg>
      <PlanImageLayer plan={{ href: "x.png", registration }} frame={frame} />
    </svg>,
  );
  const m = container
    .querySelector("image")!
    .getAttribute("transform")!
    .replace(/^matrix\(|\)$/g, "")
    .split(",")
    .map(Number);
  unmount();
  const at = ([u, v]: Point2): Point2 => [
    m[0]! * u + m[2]! * v + m[4]!,
    m[1]! * u + m[3]! * v + m[5]!,
  ];
  const { width: w, height: h } = registration;
  return { matrix: m, frame, viewport, corners: [at([0, 0]), at([w, 0]), at([w, h]), at([0, h])] };
}

/*
 * Red first, as asked: "the drawn image overlaps the zone paths" failed on these numbers. It cannot
 * pass through any faithful transform: the page drew exactly what the registration says, and in
 * model feet the registration lies wholly apart from every zone. The disagreement is upstream of
 * the web (NEEDS-CONTRACT to domains, # 29), so the test pins the web's half.
 */
test("Guest House: the web draws the registration faithfully; in model XY it misses every zone", () => {
  const { matrix, frame, corners } = drawnCorners(GUEST_HOUSE, ZONE_BOUNDS);
  // The page ran this transform on these numbers: same matrix as captured live.
  matrix.forEach((value, i) => expect(value).toBeCloseTo(DRAWN_MATRIX[i]!, 3));
  // Each pixel corner lands where the zones' frame draws the corner's model point.
  const { topLeft, topRight, bottomLeft } = GUEST_HOUSE;
  for (const [got, want] of [
    [corners[0]!, topLeft],
    [corners[1]!, topRight],
    [corners[3]!, bottomLeft],
  ] as const) {
    expect(got[0]).toBeCloseTo(frame.toViewport(want)[0], 6);
    expect(got[1]).toBeCloseTo(frame.toViewport(want)[1], 6);
  }
  const image = boxOf(corners);
  const zonesPx = ZONE_BOXES_PX.map(([minX, minY, maxX, maxY]) => ({ minX, minY, maxX, maxY }));
  expect(zonesPx.some((zone) => overlaps(image, zone))).toBe(false);
  // The same miss in model feet, before any web transform: registration x 494..628, y 753..887.
  const bottomRight: Point2 = [
    topRight[0] + bottomLeft[0] - topLeft[0],
    topRight[1] + bottomLeft[1] - topLeft[1],
  ];
  expect(overlaps(boxOf([topLeft, topRight, bottomLeft, bottomRight]), ZONE_BOUNDS)).toBe(false);
});

test("an axis-aligned crop over a zone draws over that zone, corner for corner", () => {
  const zone = { minX: 100, minY: 200, maxX: 140, maxY: 230 };
  // A 60 x 40 ft crop around the zone, exported at 1500 x 1000 px, image up = model +Y.
  const registration: TakeoffPlanImage["registration"] = {
    width: 1500,
    height: 1000,
    topLeft: [90, 235],
    topRight: [150, 235],
    bottomLeft: [90, 195],
  };
  const { frame, corners } = drawnCorners(registration, zone);
  expect(corners[0]![0]).toBeCloseTo(frame.toViewport([90, 235])[0], 6);
  expect(corners[0]![1]).toBeCloseTo(frame.toViewport([90, 235])[1], 6);
  expect(corners[2]![0]).toBeCloseTo(frame.toViewport([150, 195])[0], 6);
  expect(corners[2]![1]).toBeCloseTo(frame.toViewport([150, 195])[1], 6);
  const drawnZone = boxOf([
    frame.toViewport([zone.minX, zone.minY]),
    frame.toViewport([zone.maxX, zone.maxY]),
  ]);
  const image = boxOf(corners);
  expect(image.minX).toBeLessThan(drawnZone.minX);
  expect(image.minY).toBeLessThan(drawnZone.minY);
  expect(image.maxX).toBeGreaterThan(drawnZone.maxX);
  expect(image.maxY).toBeGreaterThan(drawnZone.maxY);
});
