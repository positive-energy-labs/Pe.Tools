import {
  settingsFieldSegments,
  type FamilyDocument,
  type SettingsFieldState,
} from "@pe/agent-contracts";
import type { FamilyModel } from "#/family/family-model";
import type { EvidenceSlice, FamilySnapshot } from "#/family/host";
import { type FamilyPageModel, buildFamilyPageModel } from "#/family/model";
import { projectFamilyModel } from "#/family/project";

interface OpenFamilyDocument {
  model: FamilyModel;
  relativePath: string;
  versionToken: string | null;
}
interface FamilySource {
  world: FamilyPageModel;
  document: OpenFamilyDocument | null;
  drawingModel: FamilyModel | null;
  parseError: string | null;
  seedKey: string;
}
export function familySource(
  snapshot: FamilySnapshot | null,
  evidence: EvidenceSlice | null,
  fields: Record<string, SettingsFieldState> = {},
  spec?: FamilyDocument["doc"],
): FamilySource {
  const relativePath = snapshot?.member.path ?? "";
  let projected: FamilyPageModel | null = null;
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
      model = JSON.parse(snapshot.composedContent.replace(/^\uFEFF/, "")) as FamilyModel;
      if (!model?.family || typeof model.family.name !== "string")
        throw new Error("The document has no family header.");
      model.types ??= {};
      if (model.parameters == null && model.familyParameters == null) model.parameters = {};
      projected = buildFamilyPageModel(projectFamilyModel(model, evidence, { path: relativePath }));
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
      projected = buildFamilyPageModel(
        projectFamilyModel(captured, evidence, { path: "Captured family (not an authored file)" }),
      );
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const versionToken = snapshot?.sha256 ?? null;
  const world = projected
    ? projected
    : buildFamilyPageModel({
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
  world.spec = spec
    ? {
        ...spec,
        blocks: spec.blocks.map((block) => ({
          ...block,
          kind: block.kind === "heading" || block.kind === "table" ? block.kind : "text",
        })),
      }
    : null;
  world.proposals = Object.entries(fields).flatMap(([pointer, field]) => {
    if (!field.proposal) return [];
    const parts = settingsFieldSegments(pointer);
    const typeName = parts[0] === "types" ? parts[1] : undefined;
    const param = typeName ? parts[2] : parts[1];
    if (!param) return [];
    return [
      {
        id: pointer,
        param,
        current: null,
        ...(typeName ? { typeName } : {}),
        proposed:
          typeof field.proposal.value === "string"
            ? field.proposal.value
            : (JSON.stringify(field.proposal.value, null, 2) ?? ""),
        sourceBlockId: field.proposal.sources?.[0]?.blockId ?? "",
        note: field.proposal.note ?? "",
        confidence: field.proposal.confidence ?? "high",
      },
    ];
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
    seedKey: model
      ? `${relativePath}@${versionToken ?? ""}`
      : evidence && "modelJson" in evidence
        ? `capture:${evidence.reading.observedAt}`
        : `empty:${relativePath}`,
  };
}
