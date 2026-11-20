import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { nativeResponseDefinitionSchema, nativeResponseSchema } from "./native-schemas.ts";
import type { RevitDetailSpaceScene } from "./generated/host-ops.generated.ts";

test("50k-row native scene decodes bounded evidence on both response paths", () => {
  const wire = JSON.parse(
    readFileSync(new URL("../tests/fixtures/scene-artifact.fixture.json", import.meta.url), "utf8"),
  );
  const schema = nativeResponseSchema("revit.detail.space-scene");
  const payload = schema.parse(wire.payload);
  const evidence = nativeResponseDefinitionSchema<RevitDetailSpaceScene.Res.SceneEvidence>(
    "revit.detail.space-scene",
    "SceneEvidence",
  ).parse(wire.evidence);
  expect(payload.evidence).toEqual(evidence);
  expect(evidence.artifact).toEqual({ id: payload.id, url: payload.url, bytes: payload.bytes });
  expect(evidence.summary.acquisition).toMatchObject({ acquired: 1, approximate: 49_999 });
  expect(evidence.summary.coverage.approximate).toBe(49_999);
  expect(payload.scene.elements).toBe(50_000);
  expect(JSON.stringify(payload).length).toBeLessThan(4096);
  expect(JSON.stringify(evidence).length).toBeLessThan(2048);
  expect(
    schema.safeParse({ ...wire.payload, evidence: { ...wire.evidence, acquisition: [] } }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ ...wire.payload, evidence: { ...wire.evidence, coverage: [] } }).success,
  ).toBe(false);
});
