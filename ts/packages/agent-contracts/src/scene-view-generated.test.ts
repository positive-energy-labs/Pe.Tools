import { expect, test } from "vite-plus/test";
import { routeAddress } from "./route-address.ts";
import { emptySpaceCut } from "./space-view.ts";
import { sceneSectionSchema } from "./scene-view.ts";
import { renderAddressTable } from "../scripts/route-address-table.ts";

test("the address emitter imports the canonical scene pose when a row references it", () => {
  const output = renderAddressTable([
    { key: "session-admin" },
    { key: "space" },
    {
      key: "witness",
      body: '{ path: "/witness", title: "Witness", fields: { sceneView: field(sceneViewSchema, "push") } }',
    },
  ]);
  expect(output).toContain('import { sceneViewSchema } from "../scene-view.ts";');
});

test.each([1, -1])(
  "a closed triangle refuses an offset that turns it inside out (%i)",
  (winding) => {
    const points: [number, number][] = [
      [0, 0],
      [4, 0],
      [2, 2 * Math.sqrt(3)],
    ];
    const triangle = (offset: number) => ({
      kind: "cuts",
      cuts: {
        top: {
          ...emptySpaceCut,
          closed: true,
          polyline: winding > 0 ? points : points.toReversed(),
          offset: offset * winding,
        },
        north: emptySpaceCut,
        east: emptySpaceCut,
      },
    });
    expect(sceneSectionSchema.safeParse(triangle(0.5)).success).toBe(true);
    const inverted = sceneSectionSchema.safeParse(triangle(3));
    expect(inverted.success).toBe(false);
    if (!inverted.success)
      expect(inverted.error.issues.map((issue) => issue.message)).toContain(
        "This offset turns the closed cut inside out.",
      );
  },
);

test.each(["duct-systems", "fans"] as const)(
  "%s generated Page accepts a bent cut but refuses a self-intersecting replacement",
  (route) => {
    const address = routeAddress(route);
    const view = {
      preset: "all" as const,
      section: {
        kind: "cuts" as const,
        cuts: {
          top: {
            ...emptySpaceCut,
            closed: true,
            polyline: [
              [0, 0],
              [4, 0],
              [4, 1],
              [1, 1],
              [1, 4],
              [0, 4],
            ],
          },
          north: emptySpaceCut,
          east: emptySpaceCut,
        },
      },
    };
    expect(address.schema.safeParse({ ...address.defaults, sceneView: view }).success).toBe(true);
    expect(address.agent.patch.safeParse({ sceneView: JSON.stringify(view) }).success).toBe(true);
    const crossed = {
      ...view,
      section: {
        ...view.section,
        cuts: {
          ...view.section.cuts,
          top: {
            ...view.section.cuts.top,
            polyline: [
              [0, 0],
              [4, 4],
              [0, 4],
              [4, 0],
            ],
          },
        },
      },
    };
    const refused = address.schema.safeParse({ ...address.defaults, sceneView: crossed });
    expect(refused.success).toBe(false);
    expect(address.agent.patch.safeParse({ sceneView: JSON.stringify(crossed) }).success).toBe(
      false,
    );
    if (!refused.success)
      expect(refused.error.issues.some((issue) => issue.message.includes("cross"))).toBe(true);
  },
);
