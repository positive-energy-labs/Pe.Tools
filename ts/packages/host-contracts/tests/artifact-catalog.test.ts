import { expect, test } from "vite-plus/test";
import { hostOpCatalog } from "../src/generated/host-catalog.generated.ts";
import type { RevitDetailSpaceScene } from "../src/generated/host-ops.generated.ts";

test("scene receipt and full artifact have separate generated contracts", () => {
  const operation = hostOpCatalog.find((entry) => entry.key === "revit.detail.space-scene")!;
  const response = JSON.parse(operation.responseSchemaJson);
  const artifact = JSON.parse(operation.artifactSchemaJson);
  expect(response.definitions.SceneReceipt.properties.elements.type).toBe("integer");
  expect(response.definitions.SceneElement).toBeUndefined();
  expect(artifact.title).toBe("SceneMetadata");
  expect(artifact.required).toContain("elements");
  expect(artifact.properties.elements.type).toBe("array");
  expect(artifact.definitions.SceneElement.required).toContain("representation");
  expect(artifact.definitions.SceneRun.required).toContain("crossSectionXAxis");
  expect(hostOpCatalog.filter((entry) => "artifactSchemaJson" in entry)).toHaveLength(1);

  // Typegen must keep the full graph reachable without putting it back on Response.
  const firstElement = (metadata: RevitDetailSpaceScene.Artifact.SceneMetadata) =>
    metadata.elements[0];
  const runWidth = (run: RevitDetailSpaceScene.Artifact.SceneRun) => run.widthFt;
  expect(typeof firstElement).toBe("function");
  expect(typeof runWidth).toBe("function");
});
