/**
 * /family host seam. The route renders exclusively against `FamilyStore`, whose live
 * implementation is the real stack: the `route:settings` document owns the open
 * family.json (snapshot + field trichotomy + validate/save), the `route:family` document
 * owns the sibling context (spec doc, Revit evidence, session binding), and
 * `settings.tree` enumerates the document list.
 *
 * The seam covers exactly what the route reads; it is deliberately NOT a general provider
 * abstraction. A fixture lane, if a page wants one, is that page's own business — this
 * module is the host half only.
 */
import { useMemo } from "react";

import {
  type SettingsProposalSource,
  familyRouteState,
  settingsFieldSegments,
  settingsRouteState,
} from "@pe/agent-contracts";
import { useTreeQuery } from "#/host/queries";
import { type RouteStatePatch, useRouteState } from "#/workbench/route-state";

/** route:settings owns the family document — this module is the only place that knows it. */
export const FAMILY_MODULE = { moduleKey: "FamilyFoundry", rootKey: "models" };

/* ── the shapes the route reads ──────────────────────────────────────────── */

export type FieldState = {
  proposal?: {
    value?: unknown;
    delete?: true;
    note?: string | null;
    confidence?: "high" | "low" | null;
    sources?: SettingsProposalSource[] | null;
  } | null;
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
  parameters: Array<{
    name: string;
    valuesPerType: Record<string, { value?: string | null }>;
  }>;
  diagnostics: unknown[];
  from: {
    origin: string;
    capturedAt: string;
    documentVersionToken?: string | null;
    familyName: string;
    rfaPath?: string | null;
  };
}

export interface FamilySpecDoc {
  parseId?: string;
  fileName?: string;
  blocks?: Array<{ id: string; page: number; kind: string; md: string }>;
  images?: Array<{ id: string; page: number; category: string }>;
}

/** A dispatcher write outcome. `hint` is the teaching channel and is surfaced verbatim. */
export interface FamilyWriteResult {
  ok: boolean;
  error?: string;
  hint?: string;
  result?: unknown;
}

export interface FamilyStore {
  /** The open family.json, or null when nothing family-shaped is open. */
  snapshot: FamilySnapshot | null;
  fields: Record<string, FieldState>;
  evidence: EvidenceSlice | null;
  doc: FamilySpecDoc | null;
  /** Relative paths of every family.json the bound session can see. */
  documents: string[];
  boundTarget: string;
  /** true on a fixture provider — the route hides host-only affordances. */
  isMock: boolean;

  /** Patch the field trichotomy (staged / review / proposal) by JSON Pointer. */
  applyFields(patches: RouteStatePatch[]): Promise<FamilyWriteResult>;
  /** route:settings lifecycle: create / open / refresh / validate / save. */
  settingsCommand(name: string, input?: Record<string, unknown>): Promise<FamilyWriteResult>;
  /** route:family lifecycle: bind / capture_evidence / build_evidence. */
  familyCommand(name: string, input?: Record<string, unknown>): Promise<FamilyWriteResult>;
  /** Write the parsed spec doc into the sibling context. */
  setSpecDoc(doc: FamilySpecDoc): Promise<FamilyWriteResult>;
  refreshDocuments(): void;
}

/* ── live ────────────────────────────────────────────────────────────────── */

export function useLiveFamilyStore(): FamilyStore {
  const settings = useRouteState(settingsRouteState);
  const family = useRouteState(familyRouteState);

  const rawSnapshot = settings.slice?.snapshot;
  const isFamilyDocument =
    rawSnapshot?.documentId.moduleKey === FAMILY_MODULE.moduleKey &&
    rawSnapshot.documentId.rootKey === FAMILY_MODULE.rootKey;
  const snapshot = isFamilyDocument ? ((rawSnapshot ?? null) as FamilySnapshot | null) : null;
  const boundTarget = family.slice?.binding?.target ?? "";

  const treeQuery = useTreeQuery(
    {
      ...FAMILY_MODULE,
      subDirectory: "",
      recursive: true,
      includeFragments: false,
      includeSchemas: false,
    },
    { bridgeSessionId: boundTarget || undefined },
  );
  const documents = useMemo(
    () =>
      (treeQuery.data?.files ?? [])
        .filter((entry) => entry.relativePath.toLowerCase().endsWith(".json"))
        .map((entry) => entry.relativePath),
    [treeQuery.data?.files],
  );

  const { apply: settingsApply, command: settingsRun } = settings;
  const { apply: familyApply, command: familyRun } = family;
  const { refetch } = treeQuery;

  return {
    snapshot,
    fields: (settings.slice?.fields ?? {}) as Record<string, FieldState>,
    evidence: (family.slice?.evidence ?? null) as EvidenceSlice | null,
    doc: (family.slice?.doc ?? null) as FamilySpecDoc | null,
    documents,
    boundTarget,
    isMock: false,
    applyFields: settingsApply,
    settingsCommand: (name, input) => settingsRun(name, input ?? {}),
    familyCommand: (name, input) => familyRun(name, input ?? {}),
    setSpecDoc: (doc) => familyApply([{ path: ["doc"], value: doc }]),
    refreshDocuments: () => void refetch(),
  };
}

/* ── local field arithmetic ──────────────────────────────────────────────── */

/** Apply one `["fields", pointer, segment]` patch to a local field map.
 * Shared with the LIVE lane, whose staged edits are tab-local by nature. */
export function patchFields(
  fields: Record<string, FieldState>,
  patches: RouteStatePatch[],
): Record<string, FieldState> {
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

/** Splice staged edits into raw JSON — what a save WOULD write, computed client-side.
 * The host's save is authoritative; this is how a surface previews the same result. */
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
