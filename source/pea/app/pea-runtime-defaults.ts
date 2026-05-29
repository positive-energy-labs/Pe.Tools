import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defaultPeaAgentModelId,
  defaultPeaFastModelId,
  defaultPeaGoalJudgeModelId,
  defaultPeaGoalMaxTurns,
  defaultPeaObservationThreshold,
  defaultPeaOmModelId,
  defaultPeaReflectionThreshold,
} from "./pea-instructions.js";
import { peaRuntimePolicy, type PeaRuntimePolicy } from "./pea-runtime-policy.js";

const peaModelPackName = "Pea OpenAI";
const peaModelPackId = `custom:${peaModelPackName}`;
const peaSettingsSchemaVersion = 1;
const mastraAppDirectoryName = "mastracode";

export type PeaThemePreference = "auto" | "dark" | "light";

export interface PeaRuntimeDefaultsSummary {
  settingsPath: string;
  modelPackId: string;
  agentModelId: string;
  fastModelId: string;
  observerModelId: string;
  reflectorModelId: string;
  goalJudgeModelId: string;
  goalMaxTurns: number;
  observationThreshold: number;
  reflectionThreshold: number;
  theme: PeaThemePreference;
  quietMode: boolean;
  quietModeMaxToolPreviewLines: number;
  policy: PeaRuntimePolicy;
}

interface JsonObject {
  [key: string]: unknown;
}

export function getPeaSettingsPath(productHomePath: string): string {
  return join(productHomePath, ".pea", mastraAppDirectoryName, "settings.json");
}

export function getPeaRuntimeDefaultsSummary(productHomePath: string): PeaRuntimeDefaultsSummary {
  return {
    settingsPath: getPeaSettingsPath(productHomePath),
    modelPackId: peaModelPackId,
    agentModelId: defaultPeaAgentModelId,
    fastModelId: defaultPeaFastModelId,
    observerModelId: defaultPeaOmModelId,
    reflectorModelId: defaultPeaOmModelId,
    goalJudgeModelId: defaultPeaGoalJudgeModelId,
    goalMaxTurns: defaultPeaGoalMaxTurns,
    observationThreshold: defaultPeaObservationThreshold,
    reflectionThreshold: defaultPeaReflectionThreshold,
    theme: "auto",
    quietMode: true,
    quietModeMaxToolPreviewLines: 0,
    policy: peaRuntimePolicy,
  };
}

export async function ensurePeaRuntimeDefaults(productHomePath: string): Promise<PeaRuntimeDefaultsSummary> {
  const defaults = getPeaRuntimeDefaultsSummary(productHomePath);
  const settings = await readSettings(defaults.settingsPath);
  const next = applyPeaDefaults(settings, defaults);

  await mkdir(dirname(defaults.settingsPath), { recursive: true });
  await writeFile(defaults.settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");

  return defaults;
}

async function readSettings(settingsPath: string): Promise<JsonObject> {
  if (!existsSync(settingsPath))
    return {};

  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf-8")) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function applyPeaDefaults(settings: JsonObject, defaults: PeaRuntimeDefaultsSummary): JsonObject {
  const onboarding = asObject(settings.onboarding);
  const models = asObject(settings.models);
  const preferences = asObject(settings.preferences);

  return {
    ...settings,
    pea: {
      ...asObject(settings.pea),
      settingsSchemaVersion: peaSettingsSchemaVersion,
      defaultsSeededAt: typeof asObject(settings.pea).defaultsSeededAt === "string"
        ? asObject(settings.pea).defaultsSeededAt
        : new Date().toISOString(),
      runtimePolicy: defaults.policy,
    },
    onboarding: {
      ...onboarding,
      modePackId: stringOrDefault(onboarding.modePackId, defaults.modelPackId),
      omPackId: stringOrDefault(onboarding.omPackId, "custom"),
      quietModePreferenceSelected: true,
    },
    models: {
      ...models,
      activeModelPackId: stringOrDefault(models.activeModelPackId, defaults.modelPackId),
      modeDefaults: {
        ...asObject(models.modeDefaults),
        agent: modelOrDefault(asObject(models.modeDefaults).agent, defaults.agentModelId),
        build: modelOrDefault(asObject(models.modeDefaults).build, defaults.agentModelId),
        plan: modelOrDefault(asObject(models.modeDefaults).plan, defaults.agentModelId),
        fast: modelOrDefault(asObject(models.modeDefaults).fast, defaults.fastModelId),
      },
      activeOmPackId: stringOrDefault(models.activeOmPackId, "custom"),
      omModelOverride: modelOrDefault(models.omModelOverride, defaults.observerModelId),
      observerModelOverride: modelOrDefault(models.observerModelOverride, defaults.observerModelId),
      reflectorModelOverride: modelOrDefault(models.reflectorModelOverride, defaults.reflectorModelId),
      omObservationThreshold: numberOrDefault(models.omObservationThreshold, defaults.observationThreshold),
      omReflectionThreshold: numberOrDefault(models.omReflectionThreshold, defaults.reflectionThreshold),
      omCavemanObservations: booleanOrDefault(models.omCavemanObservations, false),
      omObserveAttachments: observeAttachmentsOrDefault(models.omObserveAttachments, "auto"),
      subagentModels: {
        ...asObject(models.subagentModels),
      },
      goalJudgeModel: modelOrDefault(models.goalJudgeModel, defaults.goalJudgeModelId),
      goalMaxTurns: numberOrDefault(models.goalMaxTurns, defaults.goalMaxTurns),
    },
    preferences: {
      ...preferences,
      yolo: booleanOrDefault(preferences.yolo, true),
      theme: themeOrDefault(preferences.theme, defaults.theme),
      thinkingLevel: thinkingLevelOrDefault(preferences.thinkingLevel, "medium"),
      quietMode: booleanOrDefault(preferences.quietMode, defaults.quietMode),
      quietModeMaxToolPreviewLines: numberOrDefault(
        preferences.quietModeMaxToolPreviewLines,
        defaults.quietModeMaxToolPreviewLines,
      ),
    },
    customModelPacks: ensurePeaModelPack(settings.customModelPacks),
  };
}

function ensurePeaModelPack(rawPacks: unknown): JsonObject[] {
  const packs = Array.isArray(rawPacks)
    ? rawPacks.filter(isObject).map((pack) => ({ ...pack }))
    : [];
  const models = {
    agent: defaultPeaAgentModelId,
    build: defaultPeaAgentModelId,
    plan: defaultPeaAgentModelId,
    fast: defaultPeaFastModelId,
  };

  const existing = packs.find((pack) => pack.name === peaModelPackName);
  if (existing) {
    existing.models = { ...asObject(existing.models), ...models };
    return packs;
  }

  return [
    ...packs,
    {
      name: peaModelPackName,
      models,
      createdAt: new Date().toISOString(),
    },
  ];
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function modelOrDefault(value: unknown, fallback: string): string {
  return stringOrDefault(value, fallback);
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function observeAttachmentsOrDefault(value: unknown, fallback: "auto" | boolean): "auto" | boolean {
  return value === "auto" || typeof value === "boolean" ? value : fallback;
}

function themeOrDefault(value: unknown, fallback: PeaThemePreference): PeaThemePreference {
  return value === "auto" || value === "dark" || value === "light" ? value : fallback;
}

function thinkingLevelOrDefault(value: unknown, fallback: "medium"): "off" | "low" | "medium" | "high" | "xhigh" {
  return value === "off" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : fallback;
}
