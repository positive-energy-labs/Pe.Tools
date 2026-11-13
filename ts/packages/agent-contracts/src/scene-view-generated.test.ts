import { expect, test } from "vite-plus/test";
import { routeAddress } from "./route-address.ts";
import { emptySpaceCut } from "./space-view.ts";
import { sceneViewSchema } from "./scene-view.ts";
import { renderAddressTable } from "../scripts/route-address-table.ts";

test("the address emitter imports the canonical scene pose when a row references it", () => {
  const output = renderAddressTable([
    { key: "pea" },
    { key: "session-admin" },
    { key: "space" },
    {
      key: "witness",
      body: '{ path: "/witness", title: "Witness", fields: { sceneView: field(sceneViewSchema, "push") } }',
    },
  ]);
  expect(output).toContain('import { sceneViewSchema } from "../scene-view.ts";');
});

test("P3-D Pea's generated Page path accepts a bent cut but refuses its self-intersecting replacement", () => {
  const address = routeAddress("ducts");
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
  const valid = sceneViewSchema.parse(view);
  expect(address.schema.safeParse({ ...address.defaults, sceneView: valid }).success).toBe(true);
  expect(address.agent.patch.safeParse({ sceneView: JSON.stringify(valid) }).success).toBe(true);
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
  expect(address.agent.patch.safeParse({ sceneView: JSON.stringify(crossed) }).success).toBe(false);
  if (!refused.success)
    expect(refused.error.issues.some((issue) => issue.message.includes("cross"))).toBe(true);
});
