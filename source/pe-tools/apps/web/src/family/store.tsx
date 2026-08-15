/**
 * /family store seam. The route renders exclusively against `FamilyStore`, which is
 * implemented twice:
 *   - `useLiveFamilyStore()` — the real stack: the `route:settings` document owns the
 *     open family.json (snapshot + field trichotomy + validate/save), the `route:family`
 *     document owns the sibling context (spec doc, Revit evidence, session binding), and
 *     `settings.tree` enumerates the document list.
 *   - `useMockFamilyStore()` — local state over a checked-in family.json fixture plus a
 *     couple of fake pea proposals, so `/family?mock` renders with no host, no pea, and
 *     no dispatcher running.
 *
 * The seam covers exactly what the route reads; it is deliberately NOT a general provider
 * abstraction. Both hooks return the same shape, so the route picks one at the top and
 * never branches again.
 */
import { useCallback, useMemo, useState } from "react";

import {
  type SettingsProposalSource,
  familyRouteState,
  settingsFieldSegments,
  settingsRouteState,
} from "@pe/agent-contracts";
import { useTreeQuery } from "#/host/queries";
import { type RouteStatePatch, useRouteState } from "#/workbench/route-state";

import { MOCK_FAMILY_FIELDS, MOCK_FAMILY_JSON, MOCK_FAMILY_PATH } from "#/family/mock";

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
  /** true on the mock provider — the route hides host-only affordances. */
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

const OK: FamilyWriteResult = { ok: true };

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

/* ── mock ────────────────────────────────────────────────────────────────── */

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

/** Splice staged edits into raw JSON — the mock's stand-in for the host save. */
function spliceStaged(rawContent: string, fields: Record<string, FieldState>): string {
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

export function useMockFamilyStore(): FamilyStore {
  const [rawContent, setRawContent] = useState(MOCK_FAMILY_JSON);
  const [fields, setFields] = useState<Record<string, FieldState>>(MOCK_FAMILY_FIELDS);
  const [version, setVersion] = useState(1);

  const applyFields = useCallback(async (patches: RouteStatePatch[]) => {
    setFields((current) => patchFields(current, patches));
    return OK;
  }, []);

  const settingsCommand = useCallback(
    async (name: string): Promise<FamilyWriteResult> => {
      if (name === "save") {
        const staged = Object.values(fields).filter((field) => field.staged != null).length;
        if (staged === 0) return { ok: true, result: { writeApplied: false, saved: 0 } };
        setRawContent((current) => spliceStaged(current, fields));
        setFields((current) =>
          Object.fromEntries(
            Object.entries(current).map(([pointer, field]) =>
              field.staged != null ? [pointer, { review: "none" }] : [pointer, field],
            ),
          ),
        );
        setVersion((n) => n + 1);
        return { ok: true, result: { writeApplied: true, saved: staged } };
      }
      if (name === "validate") return { ok: true, result: { isValid: true, issues: [] } };
      // Everything else needs a host; say so the way the dispatcher would.
      return {
        ok: false,
        error: `${name} needs a live host.`,
        hint: "Drop the ?mock flag and bind a world to run this for real.",
      };
    },
    [fields],
  );

  return {
    snapshot: {
      documentId: { ...FAMILY_MODULE, relativePath: MOCK_FAMILY_PATH },
      rawContent,
      versionToken: `mock-v${version}`,
      validation: { isValid: true, issues: [] },
    },
    fields,
    evidence: null,
    doc: null,
    documents: [MOCK_FAMILY_PATH],
    boundTarget: "",
    isMock: true,
    applyFields,
    settingsCommand,
    familyCommand: async (name) => ({
      ok: false,
      error: `${name} needs a live Revit session.`,
      hint: "Drop the ?mock flag and bind a world to run this for real.",
    }),
    setSpecDoc: async () => OK,
    refreshDocuments: () => undefined,
  };
}
