import {
  settingsFieldPointer,
  settingsFieldSegments,
  type FamilyDocument,
  type SettingsFieldState,
} from "@pe/agent-contracts";
import { parameterText, type FamilyModel } from "#/family/family-model";
import type { EvidenceSlice, FamilySnapshot } from "#/family/types";
import { type FamilyPageModel, buildFamilyPageModel } from "#/family/model";
import { projectFamilyModel } from "#/family/project";
import type { ProtoProposal } from "#/family/world";

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
const CONSTITUENT_KIND = { nested: "nested", connectors: "connector", forms: "solid" } as const;
type ConstituentSection = keyof typeof CONSTITUENT_KIND;
const isConstituentSection = (segment: string | undefined): segment is ConstituentSection =>
  segment !== undefined && segment in CONSTITUENT_KIND;

/** What the reading holds at a pointer, as text; null when it holds nothing there. */
function heldAt(reading: FamilyModel | null, segments: readonly string[]): string | null {
  let at: unknown = reading;
  for (const segment of segments) {
    if (at == null || typeof at !== "object") return null;
    at = (at as Record<string, unknown>)[segment];
  }
  return at == null ? null : parameterText(at);
}

/** A parameter declaration as one line: `Length = 4in`, `Number ƒ A * 2`; anything else as JSON. */
function specText(value: unknown): string {
  if (value == null || typeof value !== "object") return parameterText(value);
  const spec = value as Record<string, unknown>;
  const body =
    typeof spec.formula === "string"
      ? `ƒ ${spec.formula}`
      : spec.value != null
        ? `= ${parameterText(spec.value)}`
        : null;
  const type = typeof spec.dataType === "string" ? spec.dataType : null;
  return [type, body].filter((part) => part != null).join(" ") || parameterText(value);
}

/** The one line a proposed constituent reads as in the list, from whatever object Pea sent. */
function constituentText(section: ConstituentSection, value: unknown): string {
  const spec = value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const words =
    section === "nested"
      ? [spec.family, spec.type, typeof spec.host === "string" ? `on ${spec.host}` : null]
      : section === "connectors"
        ? [spec.domain, spec.shape, spec.systemType, spec.flowDirection]
        : [spec.kind];
  return words.filter((word) => typeof word === "string" && word !== "").join(" · ") || "proposed";
}

/**
 * Proposals the accepted-by-route write mask lets through for things the reading does not hold
 * (ruled 2026-10-06, kaitpw): each must draw. A parameter only Pea names becomes a row of the
 * parameters x types grid; a constituent becomes an entry of the constituents list. Both stay
 * for as long as the suggestion stands, accepted or not, so accept and deny act on a drawn cell.
 */
function addProposedStructure(
  world: FamilyPageModel,
  reading: FamilyModel | null,
  fields: Record<string, SettingsFieldState>,
) {
  const known = new Set([
    ...world.params.map((param) => param.name),
    ...world.liveOnlyRows.map((row) => row.name),
  ]);
  for (const suggestion of world.proposals) {
    if (suggestion.constituent?.property) {
      const { slug, property } = suggestion.constituent;
      const part = world.constituents.find((entry) => entry.slug === slug);
      if (part)
        part.proposedProps = [
          ...(part.proposedProps ?? []),
          { id: suggestion.id, property, text: suggestion.proposed },
        ];
      continue;
    }
    if (suggestion.constituent) {
      const { section, slug } = suggestion.constituent;
      if (reading?.[section]?.[slug] !== undefined) continue;
      if (world.constituents.some((part) => part.slug === slug)) continue;
      world.constituents.push({
        slug,
        kind: CONSTITUENT_KIND[section],
        text: constituentText(section, fields[suggestion.id]?.suggestion?.value),
        params: [],
        proposed: suggestion.id,
      });
      continue;
    }
    const root = settingsFieldSegments(suggestion.id)[0];
    // A property of a parameter the reading lacks rides the row its spec suggestion creates.
    if ((root !== "parameters" && root !== "types") || known.has(suggestion.param)) continue;
    known.add(suggestion.param);
    const named = fields[settingsFieldPointer(["parameters", suggestion.param])]?.suggestion?.value;
    const spec =
      named != null && typeof named === "object" ? (named as Record<string, unknown>) : {};
    world.paramRows.push({
      key: suggestion.param,
      name: suggestion.param,
      dataType: typeof spec.dataType === "string" ? spec.dataType : "proposed",
      group: typeof spec.propertiesGroup === "string" ? spec.propertiesGroup : "proposed",
      isInstance: spec.isInstance === true,
      kind: "profile",
      proposed: true,
    });
  }
}

export function familySource(
  snapshot: FamilySnapshot | null,
  evidence: EvidenceSlice | null,
  fields: Record<string, SettingsFieldState> = {},
  spec?: FamilyDocument["doc"],
): FamilySource {
  const relativePath = snapshot?.member?.path ?? "";
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
      model.parameters ??= {};
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
      captured.parameters ??= {};
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
  world.spec = spec ?? null;
  const reading = model ?? capturedModel;
  world.proposals = Object.entries(fields).flatMap(([pointer, field]): ProtoProposal[] => {
    if (!field.suggestion) return [];
    const parts = settingsFieldSegments(pointer);
    const suggestion = field.suggestion;
    const shared = {
      id: pointer,
      current: heldAt(reading, parts),
      proposed:
        typeof suggestion.value === "string"
          ? suggestion.value
          : typeof suggestion.value === "boolean"
            ? String(suggestion.value)
            : parts.length === 2 && parts[0] === "parameters"
              ? specText(suggestion.value)
              : parameterText(suggestion.value),
      sourceBlockId: suggestion.sources?.[0]?.blockId ?? "",
      note: suggestion.note ?? "",
      confidence: suggestion.confidence ?? "high",
    };
    // A constituent is the whole object at `/<section>/<slug>`: no parameter row owns it.
    if (parts.length >= 2 && parts.length <= 3 && isConstituentSection(parts[0]))
      return [
        {
          ...shared,
          param: "",
          constituent: {
            section: parts[0],
            slug: parts[1]!,
            ...(parts[2] ? { property: parts[2] } : {}),
          },
        },
      ];
    // `/parameters/<name>/<property>` is about the property; `value` IS the family-level value.
    if (parts[0] === "parameters" && parts.length === 3 && parts[2] !== "value")
      return [{ ...shared, param: parts[1]!, property: parts[2]! }];
    const typeName = parts[0] === "types" ? parts[1] : undefined;
    const param = typeName ? parts[2] : parts[1];
    if (!param) return [];
    return [{ ...shared, param, ...(typeName ? { typeName } : {}) }];
  });
  addProposedStructure(world, reading, fields);
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
        ? `capture:${evidence.observedAt}`
        : `empty:${relativePath}`,
  };
}
