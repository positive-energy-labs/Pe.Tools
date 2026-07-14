/**
 * Family-types store seam. The UI renders exclusively against `FamilyTypesStore`;
 * providers implement it twice:
 *   - MockFamilyTypesProvider (here) — local state + fake FCU-400 data, for building
 *     the UI without Revit/pea/dispatcher running (`?mock`).
 *   - LiveFamilyTypesProvider (live.tsx) — the `route:family-types` document over the
 *     route-state dispatcher (all writes as `actor:"human"`), the parse endpoint for
 *     grounding, and family.editor.apply dryRun for authoritative formula checks.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import {
  type CellReview,
  type FamilyTypesCell,
  type FamilyTypesDocument,
  type SourceRef,
  cellKey,
  isFormulaCellKey,
  splitCellKey,
} from "@pe/agent-contracts";

import type { BBox } from "#/lab/mock";
import { MOCK_PEA_BATCH, buildMockDocument, mockGrounding } from "#/family-types/mock";

/** Resolves proposal provenance (md coordinates) to page geometry for the doc pane. */
export interface GroundingView {
  pages: { page: number; width: number; height: number }[];
  /** Render one page at native page coordinates; consumers scale via transforms. */
  PageView: ComponentType<{ page: number }>;
  /** null when the ref can't be resolved (block missing, ragged table). */
  targetFor(source: SourceRef): { page: number; bbox: BBox; measured: boolean } | null;
}

export interface PushOutcome {
  applied: number;
  failures: { key: string; error: string }[];
}

/** Per-cell authoritative validation from a family.editor.apply dryRun (host truth). */
export type DryRunResult = { key: string; error: string | null };

export const EMPTY_DOCUMENT: FamilyTypesDocument = {
  binding: { target: null },
  snapshot: null,
  doc: null,
  cells: {},
  pushedAt: null,
};

export interface FamilyTypesStore {
  document: FamilyTypesDocument;
  grounding: GroundingView | null;
  status: {
    bridgeConnected: boolean;
    reading: boolean;
    parsing: boolean;
    pushing: boolean;
    /** pea run in flight — the header shows a "pea is working" pill. */
    peaActive: boolean;
    /** Last rejected write/command hint, verbatim (the dispatcher's teaching text). */
    hint: string | null;
    error: string | null;
  };
  lastPush: PushOutcome | null;

  readFamily(): void | Promise<void>;
  parseSpec(input: { url?: string; file?: File }): void | Promise<void>;
  acceptProposal(key: string): void;
  rejectProposal(key: string): void;
  /** Accept every open proposal (skips read-only/formula-determined cells upstream). */
  acceptAll(): void;
  stageEdit(key: string, value: string): void;
  clearStaged(key: string): void;
  setReview(key: string, review: CellReview): void;
  push(): void | Promise<void>;

  /** Authoritative per-edit formula check (live only); undefined on the mock. */
  dryRunFormula?: (paramName: string, formula: string) => Promise<string | null>;
  /** Mock-only demo hook: streams in a pea proposal batch. */
  simulatePea?: () => void;
}

const FamilyTypesContext = createContext<FamilyTypesStore | null>(null);

export function useFamilyTypes(): FamilyTypesStore {
  const store = useContext(FamilyTypesContext);
  if (!store) throw new Error("useFamilyTypes must be used inside a FamilyTypes provider");
  return store;
}

export function FamilyTypesContextProvider({
  store,
  children,
}: {
  store: FamilyTypesStore;
  children: ReactNode;
}) {
  return <FamilyTypesContext.Provider value={store}>{children}</FamilyTypesContext.Provider>;
}

/* ── Derived helpers (pure — shared by both providers and the UI) ────────── */

export function proposalCount(doc: FamilyTypesDocument): number {
  return Object.values(doc.cells).filter((c) => c.proposal && c.staged == null).length;
}

export function stagedEntries(doc: FamilyTypesDocument): [string, FamilyTypesCell][] {
  return Object.entries(doc.cells).filter(([, c]) => c.staged != null);
}

export function attentionCount(doc: FamilyTypesDocument): number {
  return Object.values(doc.cells).filter((c) => c.review === "attention").length;
}

/** Push gate: something staged, nothing staged still marked needs-attention. */
export function canPush(doc: FamilyTypesDocument): boolean {
  const staged = stagedEntries(doc);
  return staged.length > 0 && staged.every(([, c]) => c.review !== "attention");
}

/* ── Mock provider ───────────────────────────────────────────────────────── */

export function MockFamilyTypesProvider({ children }: { children: ReactNode }) {
  const [document, setDocument] = useState<FamilyTypesDocument>(() => buildMockDocument());
  const [peaActive, setPeaActive] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [lastPush, setLastPush] = useState<PushOutcome | null>(null);

  const patchCell = useCallback((key: string, patch: Partial<FamilyTypesCell>) => {
    setDocument((prev) => {
      const cell: FamilyTypesCell = prev.cells[key] ?? { review: "none" };
      return { ...prev, cells: { ...prev.cells, [key]: { ...cell, ...patch } } };
    });
  }, []);

  const store = useMemo<FamilyTypesStore>(
    () => ({
      document,
      grounding: mockGrounding(),
      status: {
        bridgeConnected: true,
        reading: false,
        parsing: false,
        pushing,
        peaActive,
        hint: null,
        error: null,
      },
      lastPush,
      readFamily: () => setDocument(buildMockDocument()),
      parseSpec: () => undefined, // mock ships with the doc pre-parsed
      acceptProposal: (key) => {
        const proposal = document.cells[key]?.proposal;
        if (proposal) patchCell(key, { staged: { value: proposal.value } });
      },
      rejectProposal: (key) => patchCell(key, { proposal: null }),
      acceptAll: () =>
        setDocument((prev) => ({
          ...prev,
          cells: Object.fromEntries(
            Object.entries(prev.cells).map(([key, cell]) => [
              key,
              cell.proposal && cell.staged == null
                ? { ...cell, staged: { value: cell.proposal.value } }
                : cell,
            ]),
          ),
        })),
      stageEdit: (key, value) => patchCell(key, { staged: { value } }),
      clearStaged: (key) => patchCell(key, { staged: null }),
      setReview: (key, review) => patchCell(key, { review }),
      push: () => {
        setPushing(true);
        setTimeout(() => {
          setDocument((prev) => {
            const applied = stagedEntries(prev).length;
            setLastPush({ applied, failures: [] });
            const next = structuredClone(prev);
            for (const [key, cell] of Object.entries(next.cells)) {
              if (cell.staged == null) continue;
              const { paramName, typeName } = splitCellKey(key);
              const param = next.snapshot?.parameters.find((p) => p.name === paramName);
              if (param && !isFormulaCellKey(key))
                param.valuesPerType[typeName] = cell.staged.value;
              if (param && isFormulaCellKey(key)) param.formula = cell.staged.value;
              next.cells[key] = { review: "none" };
            }
            next.pushedAt = new Date().toISOString();
            return next;
          });
          setPushing(false);
        }, 900);
      },
      simulatePea: () => {
        setPeaActive(true);
        MOCK_PEA_BATCH.forEach((entry, i) => {
          setTimeout(
            () => {
              patchCell(cellKey(entry.paramName, entry.typeName), {
                proposal: entry.proposal,
                ...(entry.review ? { review: entry.review } : {}),
              });
              if (i === MOCK_PEA_BATCH.length - 1) setPeaActive(false);
            },
            350 * (i + 1),
          );
        });
      },
    }),
    [document, peaActive, pushing, lastPush, patchCell],
  );

  return <FamilyTypesContextProvider store={store}>{children}</FamilyTypesContextProvider>;
}
