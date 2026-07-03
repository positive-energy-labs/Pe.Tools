import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  type CellProposal,
  type GroundedBlock,
  type MapRequest,
  type MapResponse,
  type ParsedDocView,
  cellKey,
} from "#/pdf-audit/types";

export type ParseStatus =
  | { phase: "idle" }
  | { phase: "parsing"; fileName: string }
  | { phase: "error"; message: string }
  | { phase: "ready" };

export type MapStatus =
  | { phase: "idle" }
  | { phase: "mapping" }
  | { phase: "error"; message: string }
  | { phase: "ready"; engine: MapResponse["engine"]; note?: string };

interface PdfAuditState {
  doc: ParsedDocView | null;
  parseStatus: ParseStatus;
  mapStatus: MapStatus;
  /** cellKey -> proposal */
  proposals: Map<string, CellProposal>;
  /** cellKey -> staged value (user edit or accepted proposal) */
  edits: Map<string, string>;
  /** block currently grounded by cell hover (or pinned by click) */
  focusedBlockId: string | null;
  pinnedBlockId: string | null;

  uploadPdf: (file: File) => Promise<void>;
  clearDoc: () => void;
  runMapping: (request: Omit<MapRequest, "blocks">) => Promise<void>;
  acceptProposal: (key: string) => void;
  rejectProposal: (key: string) => void;
  acceptAllProposals: () => void;
  stageEdit: (key: string, value: string) => void;
  clearEdit: (key: string) => void;
  clearAllEdits: () => void;
  hoverCell: (key: string | null) => void;
  pinBlock: (blockId: string | null) => void;
  blockById: (blockId: string | null | undefined) => GroundedBlock | undefined;
}

const PdfAuditContext = createContext<PdfAuditState | null>(null);

export function usePdfAudit(): PdfAuditState {
  const state = useContext(PdfAuditContext);
  if (!state) throw new Error("usePdfAudit must be used inside <PdfAuditProvider>");
  return state;
}

export function PdfAuditProvider({ children }: { children: React.ReactNode }) {
  const [doc, setDoc] = useState<ParsedDocView | null>(null);
  const [parseStatus, setParseStatus] = useState<ParseStatus>({ phase: "idle" });
  const [mapStatus, setMapStatus] = useState<MapStatus>({ phase: "idle" });
  const [proposals, setProposals] = useState<Map<string, CellProposal>>(new Map());
  // Provenance survives accept/reject so hover keeps grounding accepted values.
  const [sources, setSources] = useState<Map<string, string>>(new Map());
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [pinnedBlockId, setPinnedBlockId] = useState<string | null>(null);

  const uploadPdf = useCallback(async (file: File) => {
    setParseStatus({ phase: "parsing", fileName: file.name });
    setDoc(null);
    setProposals(new Map());
    setSources(new Map());
    setMapStatus({ phase: "idle" });
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/pdf-audit/parse", { method: "POST", body: form });
      const payload = (await response.json()) as ParsedDocView & { error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? `parse failed (${response.status})`);
      }
      setDoc(payload);
      setParseStatus({ phase: "ready" });
    } catch (error) {
      setParseStatus({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const clearDoc = useCallback(() => {
    setDoc(null);
    setParseStatus({ phase: "idle" });
    setMapStatus({ phase: "idle" });
    setProposals(new Map());
    setSources(new Map());
    setHoveredBlockId(null);
    setPinnedBlockId(null);
  }, []);

  const runMapping = useCallback(
    async (request: Omit<MapRequest, "blocks">) => {
      if (!doc) return;
      setMapStatus({ phase: "mapping" });
      try {
        const body: MapRequest = {
          ...request,
          blocks: doc.blocks.map(({ id, page, kind, md }) => ({ id, page, kind, md })),
        };
        const response = await fetch("/api/pdf-audit/map", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as MapResponse & { error?: string };
        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? `mapping failed (${response.status})`);
        }
        const next = new Map<string, CellProposal>();
        const nextSources = new Map<string, string>();
        for (const proposal of payload.proposals) {
          const key = cellKey(proposal.row, proposal.column);
          next.set(key, proposal);
          if (proposal.blockId) nextSources.set(key, proposal.blockId);
        }
        setProposals(next);
        setSources(nextSources);
        setMapStatus({ phase: "ready", engine: payload.engine, note: payload.note });
      } catch (error) {
        setMapStatus({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [doc],
  );

  const acceptProposal = useCallback(
    (key: string) => {
      const proposal = proposals.get(key);
      if (!proposal) return;
      setEdits((prev) => new Map(prev).set(key, proposal.value));
      setProposals((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
    [proposals],
  );

  const rejectProposal = useCallback((key: string) => {
    setProposals((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const acceptAllProposals = useCallback(() => {
    setEdits((prev) => {
      const next = new Map(prev);
      for (const [key, proposal] of proposals) next.set(key, proposal.value);
      return next;
    });
    setProposals(new Map());
  }, [proposals]);

  const stageEdit = useCallback((key: string, value: string) => {
    setEdits((prev) => new Map(prev).set(key, value));
  }, []);

  const clearEdit = useCallback((key: string) => {
    setEdits((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const clearAllEdits = useCallback(() => {
    setEdits(new Map());
  }, []);

  const hoverCell = useCallback(
    (key: string | null) => {
      setHoveredBlockId(key ? (sources.get(key) ?? null) : null);
    },
    [sources],
  );

  const blockById = useCallback(
    (blockId: string | null | undefined) =>
      blockId ? doc?.blocks.find((block) => block.id === blockId) : undefined,
    [doc],
  );

  const value = useMemo<PdfAuditState>(
    () => ({
      doc,
      parseStatus,
      mapStatus,
      proposals,
      edits,
      focusedBlockId: pinnedBlockId ?? hoveredBlockId,
      pinnedBlockId,
      uploadPdf,
      clearDoc,
      runMapping,
      acceptProposal,
      rejectProposal,
      acceptAllProposals,
      stageEdit,
      clearEdit,
      clearAllEdits,
      hoverCell,
      pinBlock: setPinnedBlockId,
      blockById,
    }),
    [
      doc,
      parseStatus,
      mapStatus,
      proposals,
      edits,
      pinnedBlockId,
      hoveredBlockId,
      uploadPdf,
      clearDoc,
      runMapping,
      acceptProposal,
      rejectProposal,
      acceptAllProposals,
      stageEdit,
      clearEdit,
      clearAllEdits,
      hoverCell,
      blockById,
    ],
  );

  return <PdfAuditContext.Provider value={value}>{children}</PdfAuditContext.Provider>;
}
