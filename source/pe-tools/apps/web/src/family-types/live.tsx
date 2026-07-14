/**
 * Live family-types provider: FamilyTypesStore over the real stack.
 * - Document: the `route:family-types` slice of AgentController session state via
 *   useRouteState — shared live with pea's tools and every open tab. ALL writes go
 *   through the dispatcher endpoints as `actor:"human"` (unmasked); echoes arrive
 *   through `state_changed`. No client-side merges.
 * - Read family / Push: the `refresh_snapshot` / `push` dispatcher commands (push is
 *   human-only and folds staged cells into the snapshot server-side).
 * - Grounding: full ParsedDocView from the parse endpoint/cache; cell geometry via the
 *   lab-calibrated estimator (measured line boxes / interpolation).
 * - Formula dryRun: family.editor.apply with `dryRun:true` for authoritative per-edit checks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { type CellReview, familyTypesRouteState } from "@pe/agent-contracts";

import { callHostDynamic } from "#/host/client";
import { useHostStatusQuery } from "#/host/queries";
import type { ParsedDocView } from "#/grounded-doc/types";
import { type RealTarget, buildTargets } from "#/lab/estimate";
import {
  EMPTY_DOCUMENT,
  FamilyTypesContextProvider,
  type FamilyTypesStore,
  type GroundingView,
  type PushOutcome,
} from "#/family-types/store";
import { type RouteStateWriteResult, useRouteState } from "#/workbench/route-state";

export function LiveFamilyTypesProvider({ children }: { children: ReactNode }) {
  const route = useRouteState(familyTypesRouteState);
  const document = route.slice ?? EMPTY_DOCUMENT;
  const documentRef = useRef(document);
  documentRef.current = document;

  const bridgeConnected = useHostStatusQuery().data?.bridgeIsConnected ?? false;

  const [reading, setReading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [lastPush, setLastPush] = useState<PushOutcome | null>(null);

  /** Run a dispatcher write and surface its hint/error verbatim. Returns the reply. */
  const settle = useCallback(
    async (result: RouteStateWriteResult): Promise<RouteStateWriteResult> => {
      if (result.ok) {
        setError(null);
        setHint(null);
      } else {
        setError(result.error ?? "write rejected");
        setHint(result.hint ?? null);
      }
      return result;
    },
    [],
  );

  const applyCell = useCallback(
    (key: string, segment: "staged" | "review" | "proposal", value?: unknown) =>
      void route
        .apply([
          value === undefined
            ? { path: ["cells", key, segment] }
            : { path: ["cells", key, segment], value },
        ])
        .then(settle),
    [route.apply, settle],
  );

  /* ── Read family: refresh_snapshot command ───────────────────────────── */

  const readFamily = useCallback(async () => {
    setReading(true);
    try {
      await settle(await route.command("refresh_snapshot", {}));
    } finally {
      setReading(false);
    }
  }, [route.command, settle]);

  /* ── Spec doc: parse (client) + write blocks via patch + grounded view ── */

  const [groundedDoc, setGroundedDoc] = useState<ParsedDocView | null>(null);

  const parseSpec = useCallback(
    async (input: { url?: string; file?: File }) => {
      setParsing(true);
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
        // Durable state holds markdown blocks + parseId ONLY; geometry stays local.
        await settle(
          await route.apply([
            {
              path: ["doc"],
              value: {
                parseId: payload.jobId,
                fileName: payload.fileName,
                blocks: payload.blocks.map(({ id, page, kind, md }) => ({ id, page, kind, md })),
              },
            },
          ]),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setParsing(false);
      }
    },
    [route.apply, settle],
  );

  // A parse this tab didn't run (pea or another tab) — refetch the full grounded view.
  const parseId = document.doc?.parseId;
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

  const grounding = useMemo<GroundingView | null>(
    () => (groundedDoc ? buildGrounding(groundedDoc) : null),
    [groundedDoc],
  );

  /* ── Push: human-only command; per-edit failures land back on the cells ── */

  const push = useCallback(async () => {
    setPushing(true);
    try {
      const reply = await settle(await route.command("push", {}));
      if (reply.ok && reply.result) setLastPush(reply.result as PushOutcome);
    } finally {
      setPushing(false);
    }
  }, [route.command, settle]);

  /* ── Formula dryRun: authoritative per-edit check (no commit) ──────────── */

  const dryRunFormula = useCallback(
    async (paramName: string, formula: string): Promise<string | null> => {
      try {
        const raw = (await callHostDynamic("family.editor.apply", {
          edits: [{ paramName, formula }],
          dryRun: true,
        })) as { results?: { ok?: boolean; error?: string }[] } | null;
        const result = raw?.results?.[0];
        return result?.ok === false ? (result.error ?? "invalid formula") : null;
      } catch (caught) {
        return caught instanceof Error ? caught.message : String(caught);
      }
    },
    [],
  );

  const store = useMemo<FamilyTypesStore>(
    () => ({
      document,
      grounding,
      status: {
        bridgeConnected,
        reading,
        parsing,
        pushing,
        peaActive: route.peaActive,
        hint,
        error: error ?? route.error,
      },
      lastPush,
      readFamily,
      parseSpec,
      acceptProposal: (key) => {
        const proposal = documentRef.current.cells[key]?.proposal;
        if (proposal) applyCell(key, "staged", { value: proposal.value });
      },
      rejectProposal: (key) => applyCell(key, "proposal"),
      acceptAll: () => {
        const patches = Object.entries(documentRef.current.cells)
          .filter(([, cell]) => cell.proposal && cell.staged == null)
          .map(([key, cell]) => ({
            path: ["cells", key, "staged"],
            value: { value: cell.proposal!.value },
          }));
        if (patches.length) void route.apply(patches).then(settle);
      },
      stageEdit: (key, value) => applyCell(key, "staged", { value }),
      clearStaged: (key) => applyCell(key, "staged"),
      setReview: (key, review: CellReview) => applyCell(key, "review", review),
      push,
      dryRunFormula,
    }),
    [
      document,
      grounding,
      bridgeConnected,
      reading,
      parsing,
      pushing,
      route.peaActive,
      route.error,
      route.apply,
      error,
      hint,
      lastPush,
      readFamily,
      parseSpec,
      applyCell,
      settle,
      push,
      dryRunFormula,
    ],
  );

  return <FamilyTypesContextProvider store={store}>{children}</FamilyTypesContextProvider>;
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
        if (target) return { page: target.page, bbox: target.cellBBox, measured: target.measured };
      }
      const block = blockById.get(source.blockId);
      if (block?.bboxes.length) return { page: block.page, bbox: block.bboxes[0], measured: false };
      return null;
    },
  };
}
