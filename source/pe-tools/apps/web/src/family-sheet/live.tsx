/**
 * Live family-sheet provider: FamilySheetStore over the real stack.
 * - Worksheet state: the `route:family-sheet` slice of AgentController session
 *   state (useRouteState) — shared live with pea's tools and every open tab.
 * - Read family: `family.editor.snapshot` host op when registered, else the
 *   proven inline-script path from #/host/family-doc.
 * - Push: `family.editor.apply` op (values + formulas) when registered, else
 *   script apply for values (formula cells fail with a clear reason).
 * - Grounding: full ParsedDocView from the parse endpoint/cache; cell geometry
 *   via the lab-calibrated estimator (measured line boxes / interpolation).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  type CellState,
  type FamilySheetSnapshot,
  type Worksheet,
  familySheetRouteState,
  isFormulaCellKey,
  splitWorksheetCellKey,
  worksheetSchema,
} from "@pe/agent-contracts";

import { callHostDynamic } from "#/host/client";
import {
  type FamilyDocSnapshot,
  useFamilyDocApplyMutation,
  useFamilyDocSnapshotQuery,
} from "#/host/family-doc";
import { useHostStatusQuery } from "#/host/queries";
import type { ParsedDocView } from "#/grounded-doc/types";
import { type RealTarget, buildTargets } from "#/lab/estimate";
import {
  FamilySheetContextProvider,
  type FamilySheetStore,
  type GroundingView,
  type PushOutcome,
  stagedEntries,
} from "#/family-sheet/store";
import { useRouteState } from "#/workbench/route-state";

const EMPTY_WORKSHEET: Worksheet = { snapshot: null, doc: null, cells: {}, pushedAt: null };

export function LiveFamilySheetProvider({ children }: { children: ReactNode }) {
  const route = useRouteState(familySheetRouteState);
  const worksheet = route.slice ?? EMPTY_WORKSHEET;
  const worksheetRef = useRef(worksheet);
  worksheetRef.current = worksheet;

  const hostStatusQuery = useHostStatusQuery();
  const bridgeConnected = hostStatusQuery.data?.bridgeIsConnected ?? false;
  const scriptSnapshotQuery = useFamilyDocSnapshotQuery();
  const scriptApplyMutation = useFamilyDocApplyMutation();

  const [reading, setReading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPush, setLastPush] = useState<PushOutcome | null>(null);

  /** Whole-slice write (server-serialized merge; echo arrives via state_changed). */
  const writeWorksheet = useCallback(
    (mutate: (draft: Worksheet) => void) => {
      const draft = structuredClone(worksheetRef.current);
      mutate(draft);
      void route.setSlice(draft).catch((caught) => setError(errorText(caught)));
    },
    [route.setSlice],
  );

  const patchCell = useCallback(
    (key: string, patch: Partial<CellState>) => {
      writeWorksheet((draft) => {
        const cell: CellState = draft.cells[key] ?? { review: "none" };
        draft.cells[key] = { ...cell, ...patch };
      });
    },
    [writeWorksheet],
  );

  /* ── Read family: op first, script fallback ──────────────────────────── */

  const readFamily = useCallback(async () => {
    setReading(true);
    setError(null);
    try {
      let snapshot: FamilySheetSnapshot | null = null;
      try {
        const raw = await callHostDynamic("family.editor.snapshot", {});
        snapshot = coerceOpSnapshot(raw);
      } catch {
        // op not registered on this host yet — fall through to the script path
      }
      if (!snapshot) {
        const result = await scriptSnapshotQuery.refetch({ throwOnError: true });
        if (result.data) snapshot = fromScriptSnapshot(result.data);
      }
      if (!snapshot) throw new Error("Couldn't read the family document.");
      const taken = { ...snapshot, takenAt: new Date().toISOString() };
      writeWorksheet((draft) => {
        draft.snapshot = taken;
      });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setReading(false);
    }
  }, [scriptSnapshotQuery, writeWorksheet]);

  /* ── Spec doc: parse + grounded view ─────────────────────────────────── */

  const [groundedDoc, setGroundedDoc] = useState<ParsedDocView | null>(null);

  const parseSpec = useCallback(
    async (input: { url?: string; file?: File }) => {
      setParsing(true);
      setError(null);
      try {
        const form = new FormData();
        if (input.file) form.append("file", input.file);
        else if (input.url) form.append("url", input.url);
        else throw new Error("Provide a PDF file or URL.");
        const response = await fetch("/api/pdf-audit/parse", { method: "POST", body: form });
        const payload = (await response.json()) as ParsedDocView & { error?: string };
        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? `parse failed (${response.status})`);
        }
        setGroundedDoc(payload);
        writeWorksheet((draft) => {
          draft.doc = {
            parseId: payload.jobId,
            fileName: payload.fileName,
            blocks: payload.blocks.map(({ id, page, kind, md }) => ({ id, page, kind, md })),
          };
        });
      } catch (caught) {
        setError(errorText(caught));
      } finally {
        setParsing(false);
      }
    },
    [writeWorksheet],
  );

  // When the worksheet references a parse this tab didn't run (pea or another
  // tab parsed it), fetch the full grounded view from the server cache.
  const parseId = worksheet.doc?.parseId;
  useEffect(() => {
    if (!parseId || parseId === groundedDoc?.jobId) return;
    let cancelled = false;
    void fetch(`/api/pdf-audit/parse/${parseId}`)
      .then(async (response) => (response.ok ? ((await response.json()) as ParsedDocView) : null))
      .then((view) => {
        if (view && !cancelled) setGroundedDoc(view);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [parseId, groundedDoc?.jobId]);

  const grounding = useMemo<GroundingView | null>(() => {
    if (!groundedDoc) return null;
    return buildGrounding(groundedDoc);
  }, [groundedDoc]);

  /* ── Push: op first (values + formulas), script fallback (values only) ── */

  const push = useCallback(async () => {
    const staged = stagedEntries(worksheetRef.current);
    if (staged.length === 0) return;
    setPushing(true);
    setError(null);
    try {
      const outcome = await pushStaged(staged, scriptApplyMutation.mutateAsync);
      setLastPush(outcome);
      const failedKeys = new Set(outcome.failures.map((f) => f.key));
      writeWorksheet((draft) => {
        for (const [key] of staged) {
          if (failedKeys.has(key)) continue;
          const { typeName, paramName } = splitWorksheetCellKey(key);
          const param = draft.snapshot?.parameters.find((p) => p.name === paramName);
          const value = draft.cells[key]?.staged;
          if (param && value != null) {
            if (isFormulaCellKey(key)) param.formula = value;
            else param.valuesPerType[typeName] = value;
          }
          draft.cells[key] = { review: "none" };
        }
        draft.pushedAt = new Date().toISOString();
      });
      // authoritative re-read (formulas may recompute other cells)
      void readFamily();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPushing(false);
    }
  }, [scriptApplyMutation.mutateAsync, writeWorksheet, readFamily]);

  /* ── Store ────────────────────────────────────────────────────────────── */

  const store = useMemo<FamilySheetStore>(
    () => ({
      worksheet,
      grounding,
      status: {
        bridgeConnected,
        reading,
        parsing,
        pushing,
        peaActive: route.peaActive,
        error: error ?? route.error,
      },
      lastPush,
      readFamily,
      parseSpec,
      acceptProposal: (key) => {
        const proposal = worksheetRef.current.cells[key]?.proposal;
        if (proposal) patchCell(key, { staged: proposal.value });
      },
      rejectProposal: (key) => patchCell(key, { proposal: null }),
      acceptAll: () =>
        writeWorksheet((draft) => {
          for (const cell of Object.values(draft.cells)) {
            if (cell.proposal && cell.staged == null) cell.staged = cell.proposal.value;
          }
        }),
      stageEdit: (key, value) => patchCell(key, { staged: value }),
      clearStaged: (key) => patchCell(key, { staged: null }),
      setReview: (key, review) => patchCell(key, { review }),
      push,
    }),
    [
      worksheet,
      grounding,
      bridgeConnected,
      reading,
      parsing,
      pushing,
      route.peaActive,
      route.error,
      error,
      lastPush,
      readFamily,
      parseSpec,
      patchCell,
      writeWorksheet,
      push,
    ],
  );

  return <FamilySheetContextProvider store={store}>{children}</FamilySheetContextProvider>;
}

/* ── Snapshot mapping ────────────────────────────────────────────────────── */

function coerceOpSnapshot(raw: unknown): FamilySheetSnapshot | null {
  const record = raw as Record<string, unknown> | null;
  for (const candidate of [raw, record?.data, record?.snapshot]) {
    if (!candidate) continue;
    const parsed = worksheetSchema.shape.snapshot.safeParse(candidate);
    if (parsed.success && parsed.data) return parsed.data;
  }
  return null;
}

/** Map the legacy inline-script dump onto the sheet snapshot (no groups/dataType). */
function fromScriptSnapshot(script: FamilyDocSnapshot): FamilySheetSnapshot {
  return {
    familyName: script.familyName,
    currentTypeName: null,
    typeNames: script.types,
    parameters: script.parameters.map((p) => ({
      name: p.name,
      isInstance: p.isInstance,
      isReadOnly: p.isReadOnly,
      isDeterminedByFormula: !!p.formula,
      isShared: null,
      storageType: p.storageType,
      dataType: null,
      group: null,
      formula: p.formula || null,
      valuesPerType: p.values,
    })),
    takenAt: null,
  };
}

/* ── Push mechanics ──────────────────────────────────────────────────────── */

type ScriptApply = (
  edits: { paramName: string; typeName: string; value: string }[],
) => Promise<{ applied: number; failures: string[] }>;

async function pushStaged(
  staged: [string, CellState][],
  scriptApply: ScriptApply,
): Promise<PushOutcome> {
  const edits = staged.map(([key, cell]) => {
    const { paramName, typeName } = splitWorksheetCellKey(key);
    return isFormulaCellKey(key)
      ? { key, paramName, formula: cell.staged ?? "" }
      : { key, paramName, typeName, value: cell.staged ?? "" };
  });

  // Preferred: the registered batch op (values + formulas, per-edit results).
  try {
    const raw = (await callHostDynamic("family.editor.apply", {
      edits: edits.map(({ key: _key, ...edit }) => edit),
    })) as { applied?: number; results?: { index?: number; ok?: boolean; error?: string }[] };
    if (raw && Array.isArray(raw.results)) {
      const failures = raw.results
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.ok === false)
        .map(({ result, index }) => ({
          key: edits[result.index ?? index]?.key ?? "?",
          error: result.error ?? "failed",
        }));
      return { applied: raw.applied ?? edits.length - failures.length, failures };
    }
  } catch {
    // op not registered — fall through to the script path
  }

  // Fallback: the proven WriteTransaction script (values only).
  const valueEdits = edits.filter((edit) => "value" in edit);
  const formulaEdits = edits.filter((edit) => "formula" in edit);
  const failures: PushOutcome["failures"] = formulaEdits.map((edit) => ({
    key: edit.key,
    error: "Formula push requires the family.editor.apply host op (not registered yet).",
  }));
  if (valueEdits.length === 0) return { applied: 0, failures };
  const result = await scriptApply(
    valueEdits.map((edit) => ({
      paramName: edit.paramName,
      typeName: (edit as { typeName: string }).typeName,
      value: (edit as { value: string }).value,
    })),
  );
  for (const failure of result.failures) {
    // script failures are "Param (Type): reason" strings — map back to keys loosely
    const match = valueEdits.find((edit) => failure.startsWith(edit.paramName));
    failures.push({ key: match?.key ?? "?", error: failure });
  }
  return { applied: result.applied, failures };
}

/* ── Grounding over the real parse ───────────────────────────────────────── */

function buildGrounding(view: ParsedDocView): GroundingView {
  const targets = buildTargets(view);
  const byKey = new Map<string, RealTarget>(targets.map((t) => [t.key, t]));
  const blockById = new Map(view.blocks.map((b) => [b.id, b]));
  return {
    pages: view.pages.map((p) => ({ page: p.page, width: p.width, height: p.height })),
    PageView: ({ page }: { page: number }) => {
      const meta = view.pages.find((p) => p.page === page);
      if (!meta?.screenshotUrl) {
        return (
          <div
            className="flex items-center justify-center bg-white text-xs text-muted-foreground"
            style={{ width: meta?.width ?? 612, height: meta?.height ?? 792 }}
          >
            page {page} render unavailable
          </div>
        );
      }
      return (
        <img
          src={meta.screenshotUrl}
          alt={`page ${page}`}
          style={{ width: meta.width, height: meta.height }}
          draggable={false}
        />
      );
    },
    targetFor: (source) => {
      if (source.rowIdx != null && source.colIdx != null) {
        const target =
          byKey.get(`${source.blockId}:${source.rowIdx}:${source.colIdx}`) ??
          byKey.get(`${source.blockId}:${source.rowIdx}:span`);
        if (target) {
          return { page: target.page, bbox: target.cellBBox, measured: target.measured };
        }
      }
      const block = blockById.get(source.blockId);
      if (block?.bboxes.length) {
        return { page: block.page, bbox: block.bboxes[0], measured: false };
      }
      return null;
    },
  };
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
