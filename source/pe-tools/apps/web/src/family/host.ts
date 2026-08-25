import { familyRouteState, settingsFieldSegments, settingsRouteState, type SettingsProposalSource } from "@pe/agent-contracts";

import { callHostRpc } from "#/host/client";
import { fromBridgeSessions, type SessionFacts } from "#/host/target";
import { docWriter, type Scope } from "#/state/route-store";

export const FAMILY_MODULE = { moduleKey: "FamilyFoundry", rootKey: "models" };
export type FamilyPatch = { path: (string | number)[]; value?: unknown };
export type FieldState = {
  proposal?: { value?: unknown; delete?: true; note?: string | null; confidence?: "high" | "low" | null; sources?: SettingsProposalSource[] | null } | null;
  staged?: { value?: unknown; delete?: true } | null;
  review?: string;
};
export interface FamilySnapshot {
  documentId: { moduleKey: string; rootKey: string; relativePath: string };
  rawContent: string;
  versionToken?: string | null;
  validation?: { isValid: boolean; issues: unknown[] } | null;
}
export interface EvidenceSlice {
  typeNames: string[];
  parameters: Array<{ name: string; isShared?: boolean; propertiesGroup?: string | null; valuesPerType: Record<string, { value?: string | null; source?: "AuthoredGlobal" | "AuthoredTypeOverride" | "Formula" | "RevitDefault" | "Unresolved"; provenance?: "Exact" | "Inferred" | "Unresolved"; formula?: string | null }> }>;
  diagnostics: unknown[];
  from: { origin: string; capturedAt: string; documentVersionToken?: string | null; familyName: string; rfaPath?: string | null };
}
export interface FamilySpecDoc {
  parseId?: string;
  fileName?: string;
  blocks?: Array<{ id: string; page: number; kind: string; md: string }>;
  images?: Array<{ id: string; page: number; category: string }>;
}
export interface FamilyWriteResult { ok: boolean; error?: string; hint?: string; result?: unknown }
export interface FamilyHost {
  readonly fixture: boolean;
  sessions(): Promise<SessionFacts[]>;
  profile(target: string): Promise<string[]>;
  settingsApply(patches: FamilyPatch[]): Promise<FamilyWriteResult>;
  settingsCommand(name: "open" | "save", input?: Record<string, unknown>): Promise<FamilyWriteResult>;
  familyApply(patches: FamilyPatch[]): Promise<FamilyWriteResult>;
  familyCommand(name: "capture_evidence" | "build_evidence", input?: Record<string, unknown>): Promise<FamilyWriteResult>;
  readonly fixtureDocs?: { settings: unknown; family: unknown };
  readonly calls?: Array<{ op: string; input: unknown }>;
}

export function createLiveFamilyHost(scope: Scope): FamilyHost {
  const settings = docWriter(settingsRouteState, scope);
  const family = docWriter(familyRouteState, scope);
  return {
    fixture: false,
    async sessions() {
      return fromBridgeSessions((await callHostRpc("bridge.sessions.list", undefined)).sessions);
    },
    async profile(target) {
      const result = await callHostRpc(
        "settings.tree",
        { ...FAMILY_MODULE, subDirectory: "", recursive: true, includeFragments: false, includeSchemas: false },
        { bridgeSessionId: target || undefined },
      );
      return result.files.filter((entry) => entry.relativePath.toLowerCase().endsWith(".json")).map((entry) => entry.relativePath);
    },
    settingsApply: settings.apply,
    settingsCommand: settings.command,
    familyApply: family.apply,
    familyCommand: family.command,
  };
}

export function createFixtureFamilyHost(docs: { settings: unknown; family: unknown }): FamilyHost {
  const calls: Array<{ op: string; input: unknown }> = [];
  const record = async (op: string, input: unknown): Promise<FamilyWriteResult> => {
    calls.push({ op, input });
    return { ok: true, result: {} };
  };
  return {
    fixture: true,
    fixtureDocs: docs,
    calls,
    sessions: async () => [],
    profile: async () => [],
    settingsApply: (patches) => record("settings.apply", patches),
    settingsCommand: (name, input) => record(`settings.${name}`, input ?? {}),
    familyApply: (patches) => record("family.apply", patches),
    familyCommand: (name, input) => record(`family.${name}`, input ?? {}),
  };
}

export function patchFields(fields: Record<string, FieldState>, patches: FamilyPatch[]) {
  const next = { ...fields };
  for (const patch of patches) {
    const [root, pointer, segment] = patch.path as string[];
    if (root !== "fields" || !pointer) continue;
    const field: FieldState = { ...next[pointer] };
    if (segment == null) {
      if (patch.value === undefined) delete next[pointer];
      else next[pointer] = patch.value as FieldState;
      continue;
    }
    if (patch.value === undefined) delete field[segment as keyof FieldState];
    else Object.assign(field, { [segment]: patch.value });
    next[pointer] = field;
  }
  return next;
}

export function spliceStaged(rawContent: string, fields: Record<string, FieldState>): string {
  const parsed = JSON.parse(rawContent) as Record<string, unknown>;
  for (const [pointer, field] of Object.entries(fields)) {
    if (field.staged == null) continue;
    const segments = settingsFieldSegments(pointer);
    if (segments.length === 0) continue;
    let cursor = parsed;
    for (const segment of segments.slice(0, -1)) {
      const child = cursor[segment];
      if (child == null || typeof child !== "object" || Array.isArray(child)) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    const leaf = segments.at(-1)!;
    if (field.staged.delete === true) delete cursor[leaf];
    else cursor[leaf] = field.staged.value;
  }
  return JSON.stringify(parsed, null, 2);
}
