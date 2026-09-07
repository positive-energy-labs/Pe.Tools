import type { FamilyModel } from "#/family/family-model";
import type { EvidenceSlice, FamilySnapshot } from "#/family/host";
import { FIXTURE_WORLD, type PageWorld, buildPageWorld } from "#/family/model";
import { projectFamilyModel } from "#/family/project";

interface OpenFamilyDocument {
  model: FamilyModel;
  relativePath: string;
  versionToken: string | null;
}
interface FamilyLane {
  world: PageWorld;
  document: OpenFamilyDocument | null;
  drawingModel: FamilyModel | null;
  parseError: string | null;
  seedKey: string;
  fixture: boolean;
}
export function familyLane(
  snapshot: FamilySnapshot | null,
  evidence: EvidenceSlice | null,
  fixture = false,
): FamilyLane {
  const relativePath = snapshot?.documentId.relativePath ?? "";
  let projected: PageWorld | null = null;
  let model: FamilyModel | null = null;
  let parseError: string | null = null;
  let capturedModel: FamilyModel | null = null;
  if (snapshot) {
    try {
      if (snapshot.composedContent == null)
        throw new Error(
          snapshot.validation?.issues.map((issue) => issue.message).join(" · ") ||
            "No composed family document is available.",
        );
      model = JSON.parse(snapshot.composedContent) as FamilyModel;
      if (!model?.family || typeof model.family.name !== "string")
        throw new Error("The document has no family header.");
      model.types ??= {};
      if (model.parameters == null && model.familyParameters == null) model.parameters = {};
      projected = buildPageWorld(projectFamilyModel(model, evidence, { path: relativePath }));
    } catch (error) {
      model = null;
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!snapshot && evidence && "modelJson" in evidence) {
    try {
      const captured = JSON.parse(evidence.modelJson) as FamilyModel;
      capturedModel = captured;
      if (!captured?.family || typeof captured.family.name !== "string")
        throw new Error("The capture has no family header.");
      captured.types ??= {};
      projected = buildPageWorld(
        projectFamilyModel(captured, evidence, { path: "Captured family (not an authored file)" }),
      );
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const versionToken = snapshot?.versionToken ?? null;
  const world = projected
    ? projected
    : fixture
      ? FIXTURE_WORLD
      : buildPageWorld({
          profile: {
            path: relativePath,
            familyName: "No family document",
            category: "",
            template: "",
            placement: "",
            params: [],
            types: {},
            solids: {},
            connectors: {},
          },
          live: null,
          spec: null,
          proposals: [],
        });
  return {
    world,
    drawingModel: model ?? capturedModel,
    document: model
      ? {
          model,
          relativePath,
          versionToken,
        }
      : null,
    parseError,
    fixture,
    seedKey: model
      ? `${relativePath}@${versionToken ?? ""}`
      : fixture
        ? "fixture"
        : evidence && "modelJson" in evidence
          ? `capture:${evidence.reading.observedAt}`
          : `empty:${relativePath}`,
  };
}
