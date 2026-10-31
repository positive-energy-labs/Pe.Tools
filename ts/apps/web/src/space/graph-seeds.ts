import { FIXTURE_ANSWERS, FIXTURE_SCENE } from "./fixture";
import { loadedScene } from "./sources";
export const spaceSeeds = {
  fixture: {
    title: "Spatial inspection",
    page: { scene: "f".repeat(64) },
    queries: {
      "revit.detail.space-scene": {
        document: { session: "fixture", openId: "space" },
        request: {
          elementIds: [101],
          contextPaddingFt: 0,
          maxTriangles: 100000,
          focusOnly: false,
          contextRepresentation: "link-boxes",
        },
        response: { id: "f".repeat(64), scene: FIXTURE_SCENE.metadata.stamp },
      },
      ...Object.fromEntries(
        Object.entries(FIXTURE_ANSWERS).map(([key, answer]) => [
          `revit.detail.space-${key}`,
          { ...answer, document: { session: "fixture", openId: "space" } },
        ]),
      ),
    },
    readings: { scene: loadedScene("f".repeat(64), FIXTURE_SCENE), answers: FIXTURE_ANSWERS },
  },
};
