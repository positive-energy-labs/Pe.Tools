/**
 * /family LIVE lane — the family open in the bound session's Revit family editor.
 *
 * LANE LAW: the lane is chosen by what the sentence's document slot binds; it is never a
 * toggle. Picking a family.json binds the AUTHORED lane; picking "family open in <world>"
 * binds this one. Both lanes render the SAME matrix, formula column, review/staging
 * machinery, doc pane, and inspector — the difference is where truth comes from and what
 * a save means.
 *
 * The trick that keeps the route one route: this lane projects `family.editor.snapshot`
 * into the same authored FamilyModel JSON the authored lane parses, so `parseModel`,
 * `changedLeaves`, and every JSON-Pointer field key work unchanged. Only three things
 * differ, and they are all real:
 *   - staged edits are TAB-LOCAL (a live family is not a document; there is nothing for
 *     route:settings to own, and no pea proposals arrive here — see SHIMS),
 *   - `save` is `family.editor.apply`, where per-edit failure is REAL: the receipt reports
 *     per-edit outcomes and failed edits stay staged for retry,
 *   - a formula commit fires `family.editor.apply {dryRun:true}` as a non-blocking
 *     ADVISORY — the host's own verdict, rendered on the same clay dot as the client
 *     validator's problems.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { settingsFieldSegments } from "@pe/agent-contracts";
import type { FamilyEditorApply, FamilyEditorSnapshot } from "@pe/host-contracts/generated";
import type { SlotOption } from "#/components/sentence";
import { callHostRpc } from "#/host/client";
import { useFleet, worldName } from "#/host/fleet";
import { HOST_QUERY_KEY, useHostOp } from "#/host/queries";
import { resolveTarget } from "#/host/target";
import {
  type FamilyStore,
  type FamilyWriteResult,
  type FieldState,
  patchFields,
} from "#/family/store";
import type { RouteStatePatch } from "#/workbench/route-state";

type Snapshot = FamilyEditorSnapshot.Res.Response;
type ApplyEdit = FamilyEditorApply.Req.FamilyEditorApplyEdit;

/**
 * The synthetic document-slot entry that binds this lane. Not a path — the live family
 * editor itself. The WORLD is spoken once, by the sentence's own world clause (and echoed
 * in the lane chip), so this entry deliberately does not repeat it.
 */
export const LIVE_DOCUMENT_ENTRY = "the open family editor";

export interface LiveApplyFailure {
  pointer: string;
  label: string;
  error: string;
}

export interface LiveLaneApi {
  /** True when the bound session's ACTIVE document is a family document. */
  available: boolean;
  /** Human name of the bound world, for the lane chip and the doc-slot entry. */
  world: string | null;
  familyName: string | null;
  /** When the current snapshot was read, for the "read Xm ago" staleness text. */
  readAtMs: number | null;
  reading: boolean;
  error: string | null;
  refresh(): void;
  /** family.editor.apply over the staged pointers. Failed edits STAY staged. */
  save(): Promise<{ saved: number; failed: number; failures: LiveApplyFailure[] }>;
  /** Per-edit dryRun advisory for one formula. Non-blocking; result lands on `advisory`. */
  check(paramName: string, formula: string): void;
  advisory(paramName: string): string | null;
  /** Loaded families of the bound session's project, for the sentence's family slot. */
  families: SlotOption[];
  openFamily(familyId: string): Promise<void>;
}

/* ── snapshot → the authored FamilyModel shape the matrix already renders ────────────────────── */

/**
 * Project a family-editor snapshot onto the authored JSON shape. Deliberately partial:
 * a live family has no authored anatomy (no solids, planes, connectors), so the triptych
 * has nothing to draw and the route hides it. Per-type display values land in `types`
 * (Revit's family types ARE per-type values — there is no authored "family value"), and a
 * formula-driven parameter's computed values land in `resolvedValues`, so the matrix's
 * formula lock renders the real number instead of the word "locked".
 */
export function liveFamilyModel(snapshot: Snapshot): Record<string, unknown> {
  const familyParameters: Record<string, Record<string, unknown>> = {};
  const sharedParameters: Record<string, Record<string, unknown>> = {};
  const types: Record<string, Record<string, string>> = {};
  for (const typeName of snapshot.typeNames) types[typeName] = {};

  for (const parameter of snapshot.parameters) {
    const spec: Record<string, unknown> = {
      dataType: parameter.dataType ?? parameter.storageType,
      isInstance: parameter.isInstance,
    };
    if (parameter.group) spec.propertiesGroup = parameter.group;
    if (parameter.isReadOnly) spec.readOnly = true;
    if (parameter.formula) {
      spec.formula = parameter.formula;
      spec.resolvedValues = { ...parameter.valuesPerType };
    } else {
      for (const [typeName, value] of Object.entries(parameter.valuesPerType))
        if (types[typeName]) types[typeName][parameter.name] = value;
    }
    (parameter.isShared ? sharedParameters : familyParameters)[parameter.name] = spec;
  }

  return {
    family: {
      name: snapshot.familyName,
      category: "",
      template: "",
      placement: "",
    },
    familyParameters,
    sharedParameters,
    types,
  };
}

/**
 * One staged pointer → one family-editor edit. The pointer scheme is the authored one, so
 * the same `update`/`changedLeaves` machinery produced it:
 *   /types/<type>/<param>                     → a per-type value
 *   /familyParameters|sharedParameters/<p>/formula → a formula (empty clears it)
 * Anything else has no live meaning and is reported rather than silently dropped.
 */
export function pointerToEdit(
  pointer: string,
  staged: { value?: unknown; delete?: true },
): { edit: ApplyEdit; label: string } | { unsupported: string } {
  const segments = settingsFieldSegments(pointer);
  // Every live-editable leaf is a display string; anything else is a structural edit with
  // no live equivalent, and falls through to `unsupported` below.
  const value = staged.value;
  const text =
    staged.delete === true || value == null
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
  if (segments[0] === "types" && segments.length === 3)
    return {
      edit: { paramName: segments[2], typeName: segments[1], value: text },
      label: `${segments[2]} · ${segments[1]}`,
    };
  if (
    (segments[0] === "familyParameters" || segments[0] === "sharedParameters") &&
    segments[2] === "formula" &&
    segments.length === 3
  )
    return { edit: { paramName: segments[1], formula: text }, label: `${segments[1]} · formula` };
  return { unsupported: pointer };
}

/* ── the lane ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Wrap the authored store with a live-editor one: snapshot in place of the document,
 * tab-local fields in place of route:settings fields, and every dispatcher command
 * (bind, capture_evidence, settings create) delegated to the real slices — capture is
 * the bridge BETWEEN the lanes, so it must keep speaking to them both.
 */
export function useFamilyEditorLane(
  authored: FamilyStore,
  active: boolean,
): { store: FamilyStore; api: LiveLaneApi } {
  const target = authored.boundTarget;
  const scope = target || undefined;
  const queryClient = useQueryClient();
  const { sessions } = useFleet();

  const resolution = resolveTarget(sessions, target);
  const session = resolution.kind === "resolved" ? resolution.session : null;
  const available = session?.activeDocumentIsFamilyDocument === true;
  const world = session ? worldName(session) : null;

  const snapshotQuery = useHostOp(
    "family.editor.snapshot",
    {},
    { bridgeSessionId: scope, enabled: active && available, staleTime: Infinity },
  );
  const snapshot = snapshotQuery.data ?? null;

  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const [advisories, setAdvisories] = useState<Record<string, string | null>>({});
  const [applyError, setApplyError] = useState<string | null>(null);

  const rawContent = useMemo(
    () => (snapshot ? JSON.stringify(liveFamilyModel(snapshot)) : null),
    [snapshot],
  );

  const applyFields = useCallback(
    async (patches: RouteStatePatch[]): Promise<FamilyWriteResult> => {
      setFields((current) => patchFields(current, patches));
      return { ok: true };
    },
    [],
  );

  /* ── the project's loaded families, for the sentence's family slot ── */
  const documentSession = useHostOp("revit.context.document-session", undefined, {
    bridgeSessionId: scope,
    enabled: active && Boolean(target),
    staleTime: 30_000,
  });
  const hasProject =
    documentSession.data?.openDocuments.some((document) => !document.isFamilyDocument) ?? false;
  const loaded = useHostOp(
    "revit.catalog.loaded-families",
    { projection: { view: "Handles" } },
    {
      bridgeSessionId: scope,
      enabled: active && Boolean(target) && hasProject,
      staleTime: 60_000,
    },
  );
  const families = useMemo<SlotOption[]>(
    () =>
      (loaded.data?.families ?? []).map((family) => ({
        id: String(family.familyId),
        label: family.familyName,
        sub: `${family.categoryName} · ${family.typeCount} type${family.typeCount === 1 ? "" : "s"}`,
      })),
    [loaded.data?.families],
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...HOST_QUERY_KEY, target] });
  }, [queryClient, target]);

  const openFamily = useCallback(
    async (familyId: string) => {
      setApplyError(null);
      try {
        await callHostRpc(
          "family.editor.open",
          { familyId: Number(familyId) },
          scope ? { bridgeSessionId: scope } : undefined,
        );
        setFields({});
        setAdvisories({});
        invalidate();
      } catch (caught) {
        setApplyError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [scope, invalidate],
  );

  /* ── save: per-edit outcomes are REAL; failures stay staged ── */
  const { refetch } = snapshotQuery;
  const save = useCallback(async () => {
    const staged = Object.entries(fieldsRef.current).filter(([, field]) => field.staged != null);
    const edits: ApplyEdit[] = [];
    const labels: Array<{ pointer: string; label: string }> = [];
    const failures: LiveApplyFailure[] = [];
    for (const [pointer, field] of staged) {
      const mapped = pointerToEdit(pointer, field.staged!);
      if ("unsupported" in mapped) {
        failures.push({
          pointer,
          label: pointer,
          error: "no live equivalent — this edit only exists in the authored lane",
        });
        continue;
      }
      edits.push(mapped.edit);
      labels.push({ pointer, label: mapped.label });
    }
    if (edits.length === 0) return { saved: 0, failed: failures.length, failures };

    setApplyError(null);
    let response: FamilyEditorApply.Res.Response;
    try {
      response = await callHostRpc(
        "family.editor.apply",
        { edits },
        scope ? { bridgeSessionId: scope } : undefined,
      );
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      setApplyError(error);
      return {
        saved: 0,
        failed: edits.length + failures.length,
        failures: [...failures, ...labels.map((entry) => ({ ...entry, error }))],
      };
    }

    const failedIndexes = new Set<number>();
    for (const result of response.results) {
      if (result.ok) continue;
      failedIndexes.add(result.index);
      const entry = labels[result.index];
      failures.push({
        pointer: entry?.pointer ?? String(result.index),
        label: entry?.label ?? `edit ${result.index}`,
        error: result.error ?? "failed",
      });
    }
    // Clear only what LANDED — a failed edit stays staged so it can be fixed and retried.
    const cleared = labels
      .filter((_, index) => !failedIndexes.has(index))
      .map((entry) => entry.pointer);
    setFields((current) => {
      const next = { ...current };
      for (const pointer of cleared) delete next[pointer];
      return next;
    });
    void refetch();
    return { saved: response.applied, failed: failures.length, failures };
  }, [scope, refetch]);

  /* ── dryRun advisory ── */
  const check = useCallback(
    (paramName: string, formula: string) => {
      if (!formula.trim()) {
        setAdvisories((current) => ({ ...current, [paramName]: null }));
        return;
      }
      void (async () => {
        try {
          const response = await callHostRpc(
            "family.editor.apply",
            { edits: [{ paramName, formula }], dryRun: true },
            scope ? { bridgeSessionId: scope } : undefined,
          );
          const first = response.results[0];
          setAdvisories((current) => ({
            ...current,
            [paramName]:
              first && !first.ok ? (first.error ?? "the host rejected this formula") : null,
          }));
        } catch (caught) {
          setAdvisories((current) => ({
            ...current,
            [paramName]: caught instanceof Error ? caught.message : String(caught),
          }));
        }
      })();
    },
    [scope],
  );

  const store: FamilyStore = {
    ...authored,
    snapshot: rawContent
      ? {
          documentId: {
            moduleKey: "family.editor",
            rootKey: "live",
            relativePath: snapshot?.familyName ?? "family",
          },
          rawContent,
          versionToken: snapshotQuery.dataUpdatedAt ? String(snapshotQuery.dataUpdatedAt) : null,
          validation: null,
        }
      : null,
    fields,
    applyFields,
  };

  const api: LiveLaneApi = {
    available,
    world,
    familyName: snapshot?.familyName ?? null,
    readAtMs: snapshotQuery.dataUpdatedAt || null,
    reading: snapshotQuery.isFetching,
    error:
      applyError ??
      (snapshotQuery.error instanceof Error ? snapshotQuery.error.message : null) ??
      (loaded.error instanceof Error ? loaded.error.message : null),
    refresh: () => void refetch(),
    save,
    check,
    advisory: (paramName) => advisories[paramName] ?? null,
    families,
    openFamily,
  };

  return { store, api };
}

/** Compact relative-time label — the family-types staleness idiom, kept verbatim. */
export function readAgo(atMs: number | null): string | null {
  if (!atMs) return null;
  const minutes = Math.round((Date.now() - atMs) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
