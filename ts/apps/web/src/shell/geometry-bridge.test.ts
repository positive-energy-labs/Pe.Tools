// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { HostCallError } from "@pe/host-contracts/operation-types";
import { callHostRpc } from "#/host/client";
import { callOp } from "./readings-api";
import { geometryBudget } from "./geometry";

const refusal = {
  kind: "over-budget",
  count: 120,
  ceiling: 100,
  representation: "meshes",
  perSource: [{ source: 0, count: 120 }],
};
vi.mock("#/host/runtime", () => ({
  hostFetch: async () =>
    Response.json(
      { error: { code: "over-budget", message: "Geometry refused", details: refusal } },
      { status: 422 },
    ),
}));

test.each(["picture", "query"])(
  "%s bridge retains the typed refusal and its source evidence",
  async (door) => {
    const request = {
      elementIds: [1],
      contextPaddingFt: 0,
      maxTriangles: 1000,
      focusOnly: false,
      contextRepresentation: "meshes" as const,
    };
    try {
      if (door === "picture") await callHostRpc("revit.detail.space-scene", request);
      else
        await callOp({ signal: new AbortController().signal }, "revit.detail.space-scene", request);
      expect.fail("Admission must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(HostCallError);
      expect(geometryBudget(error)).toEqual(refusal);
      expect((error as Error).message).toContain("(meshes): 120 > 100.");
    }
  },
);
