/**
 * Family-sheet store seam. The UI renders exclusively against `FamilySheetStore`;
 * providers implement it twice:
 *   - MockFamilySheetProvider (here) — local state + fake ACME data, for building
 *     the UI without Revit/pea running.
 *   - LiveFamilySheetProvider (live.tsx, integration phase) — the worksheet slice
 *     of AgentController session state via useRouteState, host RPC for read/push,
 *     parse cache for grounding.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import {
  type CellReview,
  type CellState,
  type SourceRef,
  type Worksheet,
  worksheetCellKey,
} from "@pe/agent-contracts";

import type { BBox } from "#/lab/mock";
import { MOCK_PEA_BATCH, buildMockWorksheet, mockGrounding } from "#/family-sheet/mock";

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

export interface FamilySheetStore {
  worksheet: Worksheet;
  grounding: GroundingView | null;
  status: {
    bridgeConnected: boolean;
    reading: boolean;
    parsing: boolean;
    pushing: boolean;
    /** pea run in flight — UI shows a "pea is working" hint near the grid. */
    peaActive: boolean;
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

  /** Mock-only demo hook (undefined on the live provider): streams in a pea proposal batch. */
  simulatePea?: () => void;
}

const FamilySheetContext = createContext<FamilySheetStore | null>(null);

export function useFamilySheet(): FamilySheetStore {
  const store = useContext(FamilySheetContext);
  if (!store) throw new Error("useFamilySheet must be used inside a FamilySheet provider");
  return store;
}

export function FamilySheetContextProvider({
  store,
  children,
}: {
  store: FamilySheetStore;
  children: ReactNode;
}) {
  return <FamilySheetContext.Provider value={store}>{children}</FamilySheetContext.Provider>;
}

/* ── Derived helpers (pure — shared by both providers and the UI) ────────── */

export function proposalCount(worksheet: Worksheet): number {
  return Object.values(worksheet.cells).filter((c) => c.proposal && c.staged == null).length;
}

export function stagedEntries(worksheet: Worksheet): [string, CellState][] {
  return Object.entries(worksheet.cells).filter(([, c]) => c.staged != null);
}

export function attentionCount(worksheet: Worksheet): number {
  return Object.values(worksheet.cells).filter((c) => c.review === "attention").length;
}

/** Push gate: something staged, nothing staged still marked needs-attention. */
export function canPush(worksheet: Worksheet): boolean {
  const staged = stagedEntries(worksheet);
  return staged.length > 0 && staged.every(([, c]) => c.review !== "attention");
}

/* ── Mock provider ───────────────────────────────────────────────────────── */

export function MockFamilySheetProvider({ children }: { children: ReactNode }) {
  const [worksheet, setWorksheet] = useState<Worksheet>(() => buildMockWorksheet());
  const [peaActive, setPeaActive] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [lastPush, setLastPush] = useState<PushOutcome | null>(null);

  const patchCell = useCallback((key: string, patch: Partial<CellState>) => {
    setWorksheet((prev) => {
      const cell: CellState = prev.cells[key] ?? { review: "none" };
      return { ...prev, cells: { ...prev.cells, [key]: { ...cell, ...patch } } };
    });
  }, []);

  const store = useMemo<FamilySheetStore>(
    () => ({
      worksheet,
      grounding: mockGrounding(),
      status: {
        bridgeConnected: true,
        reading: false,
        parsing: false,
        pushing,
        peaActive,
        error: null,
      },
      lastPush,
      readFamily: () => setWorksheet(buildMockWorksheet()),
      parseSpec: () => undefined, // mock ships with the doc pre-parsed
      acceptProposal: (key) => {
        const proposal = worksheet.cells[key]?.proposal;
        if (proposal) patchCell(key, { staged: proposal.value });
      },
      rejectProposal: (key) => patchCell(key, { proposal: null }),
      acceptAll: () =>
        setWorksheet((prev) => ({
          ...prev,
          cells: Object.fromEntries(
            Object.entries(prev.cells).map(([key, cell]) => [
              key,
              cell.proposal && cell.staged == null
                ? { ...cell, staged: cell.proposal.value }
                : cell,
            ]),
          ),
        })),
      stageEdit: (key, value) => patchCell(key, { staged: value }),
      clearStaged: (key) => patchCell(key, { staged: null }),
      setReview: (key, review) => patchCell(key, { review }),
      push: () => {
        setPushing(true);
        setTimeout(() => {
          setWorksheet((prev) => {
            const applied = stagedEntries(prev).length;
            setLastPush({ applied, failures: [] });
            // mock: staged values land in the snapshot, cells reset
            const next = structuredClone(prev);
            for (const [key, cell] of Object.entries(next.cells)) {
              if (cell.staged == null) continue;
              const sep = key.lastIndexOf("::");
              const [paramName, typeName] = [key.slice(0, sep), key.slice(sep + 2)];
              const param = next.snapshot?.parameters.find((p) => p.name === paramName);
              if (param && typeName !== "@formula") param.valuesPerType[typeName] = cell.staged;
              if (param && typeName === "@formula") param.formula = cell.staged;
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
              patchCell(worksheetCellKey(entry.paramName, entry.typeName), {
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
    [worksheet, peaActive, pushing, lastPush, patchCell],
  );

  return <FamilySheetContextProvider store={store}>{children}</FamilySheetContextProvider>;
}
