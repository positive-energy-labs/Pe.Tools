import type { FamilyModel } from "#/family/family-model";
import type { EvidenceSlice, FamilySnapshot } from "#/family/host";
import { FIXTURE_WORLD, type PageWorld, buildPageWorld } from "#/family/model";
import { projectFamilyModel } from "#/family/project";

export interface OpenFamilyDocument { model: FamilyModel; relativePath: string; versionToken: string | null; evidenceStale: boolean }
export interface FamilyLane { world: PageWorld; document: OpenFamilyDocument | null; parseError: string | null; seedKey: string }
export function isEvidenceStale(evidenceToken: string | null | undefined, documentToken: string | null) {
  return evidenceToken != null && documentToken != null && evidenceToken !== documentToken;
}
export function familyLane(snapshot: FamilySnapshot | null, evidence: EvidenceSlice | null): FamilyLane {
  let model: FamilyModel | null = null;
  let parseError: string | null = null;
  if (snapshot) {
    try {
      model = JSON.parse(snapshot.rawContent) as FamilyModel;
      if (model.familyParameters == null || model.types == null) throw new Error("no familyParameters/types - this is valid JSON but not a family model");
    } catch (error) {
      model = null;
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const relativePath = snapshot?.documentId.relativePath ?? "";
  const versionToken = snapshot?.versionToken ?? null;
  const world = model ? buildPageWorld(projectFamilyModel(model, evidence, { path: relativePath })) : FIXTURE_WORLD;
  return {
    world,
    document: model ? { model, relativePath, versionToken, evidenceStale: isEvidenceStale(evidence?.from.documentVersionToken, versionToken) } : null,
    parseError,
    seedKey: model ? `${relativePath}@${versionToken ?? ""}` : "fixture",
  };
}
