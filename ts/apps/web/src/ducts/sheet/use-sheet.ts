import { useEffect, useRef, useState } from "react";
import type {
  DocumentRef,
  DuctsSheetOverview,
  DuctsSheetEdits,
  DuctsSheetRequest,
  DuctsRosterResponse,
} from "@pe/agent-contracts";
import { fanKey, readRoster, readSheet, StaleSheet, type Detail, type FanPort } from "./api";

export type OpenSheet = {
  overview: DuctsSheetOverview;
  inputs: Detail<"inputs"> | null;
  elements: Detail<"elements"> | null;
  legs: Detail<"legs"> | null;
  worstLegs: Detail<"legs">[];
  /** Every run and section (ducts LEDGER 2026-10-29): the worksheet table and the picture's strands. */
  worksheet: Detail<"worksheet"> | null;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Mounted by document lifetime: cancellation and late answers cannot cross into another target. */
export function useSheet(target: DocumentRef) {
  const [rows, setRows] = useState<FanPort[]>([]);
  const [slots, setSlots] = useState<DuctsRosterResponse["slots"]>([]);
  const [activeSlot, setActiveSlot] = useState("");
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    mark: string;
    stopped: boolean;
  } | null>(null);
  const detailJob = useRef<AbortController | null>(null);
  const batchJob = useRef<AbortController | null>(null);
  const rosterJob = useRef<AbortController | null>(null);

  const refresh = async () => {
    rosterJob.current?.abort();
    const job = new AbortController();
    rosterJob.current = job;
    setLoading(true);
    setError(null);
    try {
      const roster = await readRoster(target, job.signal);
      if (!job.signal.aborted) {
        setRows(roster.rows);
        setSlots(roster.slots);
        setActiveSlot(roster.activeSlot);
      }
    } catch (cause) {
      if (!job.signal.aborted) setError(message(cause));
    } finally {
      if (!job.signal.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    return () => {
      rosterJob.current?.abort();
      detailJob.current?.abort();
      batchJob.current?.abort();
    };
  }, [target.session, target.openId]); // target values define this mounted workspace

  const overview = async (
    fan: Pick<FanPort, "unitId" | "portIndex">,
    signal: AbortSignal,
    edits?: DuctsSheetEdits,
    proposal?: DuctsSheetRequest["proposal"],
    basis?: string,
  ) => {
    const result = await readSheet(
      {
        target,
        mode: "fan",
        unitId: fan.unitId,
        portIndex: fan.portIndex,
        edits,
        proposal,
        basis,
      },
      signal,
    );
    if (result.kind !== "overview") throw Error("Expected a fan sheet overview");
    if (!signal.aborted)
      setRows((rows) =>
        rows.map((row) =>
          fanKey(row) === fanKey(fan)
            ? {
                ...row,
                blockerCount: result.blockers.length,
                requiredEspInWg: result.totals?.requiredEspInWg ?? null,
                requiredEspAssumedInWg: result.totals?.requiredEspAssumedInWg ?? null,
                complete:
                  result.totals != null &&
                  result.totals.supply.complete &&
                  result.totals.return.complete,
              }
            : row,
        ),
      );
    return result;
  };
  const detail = async <K extends "inputs" | "elements" | "legs" | "worksheet">(
    base: DuctsSheetOverview,
    kind: K,
    signal: AbortSignal,
    pathId?: string,
  ): Promise<Detail<K>> => {
    if (!base.fan) throw Error("Expected a fan port");
    const result = await readSheet(
      {
        target: base.target,
        mode: "fan",
        unitId: base.fan.unitId,
        portIndex: base.fan.portIndex,
        basis: base.basis,
        detail: kind === "legs" ? { kind, pathId: pathId! } : { kind },
      },
      signal,
    );
    if (result.kind !== kind || result.basis !== base.basis)
      throw Error("Sheet detail does not match its overview");
    return result as Detail<K>;
  };
  const blank = (base: DuctsSheetOverview): OpenSheet => ({
    overview: base,
    inputs: null,
    elements: null,
    legs: null,
    worstLegs: [],
    worksheet: null,
  });
  const recoverStale = async (base: DuctsSheetOverview, signal: AbortSignal) => {
    if (!base.fan) return;
    const fresh = await overview(base.fan, signal);
    if (!signal.aborted) {
      setSheet(blank(fresh));
      setError(
        "Sheet changed. Overview refreshed; compute this fan again to load current details.",
      );
    }
  };
  const compute = async (
    fan: Pick<FanPort, "unitId" | "portIndex">,
    edits?: DuctsSheetEdits,
    proposal?: DuctsSheetRequest["proposal"],
    reread = false,
  ): Promise<DuctsSheetOverview | null> => {
    if (batchJob.current) return null;
    detailJob.current?.abort();
    const job = new AbortController();
    detailJob.current = job;
    setBusy(true);
    setProgress(null);
    setError(null);
    let base: DuctsSheetOverview | null = null;
    try {
      base = await overview(
        fan,
        job.signal,
        edits,
        proposal,
        proposal ? sheet?.overview.basis : undefined,
      );
      // An edit moves the layers every fan is priced under: the roster's other rows go stale, so
      // re-read them, then keep this fan's fresh numbers from the overview just computed.
      if (edits || reread) {
        const roster = await readRoster(target, job.signal);
        const fresh = base;
        if (!job.signal.aborted) {
          setRows(
            roster.rows.map((row) =>
              fanKey(row) === fanKey(fan)
                ? {
                    ...row,
                    blockerCount: fresh.blockers.length,
                    requiredEspInWg: fresh.totals?.requiredEspInWg ?? null,
                    requiredEspAssumedInWg: fresh.totals?.requiredEspAssumedInWg ?? null,
                    complete:
                      fresh.totals != null &&
                      fresh.totals.supply.complete &&
                      fresh.totals.return.complete,
                  }
                : row,
            ),
          );
          setSlots(roster.slots);
          setActiveSlot(roster.activeSlot);
        }
      }
      if (job.signal.aborted) return null;
      setSheet(blank(base));
      const worst = (["supply", "return"] as const).flatMap((side) =>
        base!.totals?.[side].complete && base!.paths[side].paths[0]
          ? [base!.paths[side].paths[0]!.pathId]
          : [],
      );
      const [inputs, elements, worksheet, ...worstLegs] = await Promise.all([
        detail(base, "inputs", job.signal),
        detail(base, "elements", job.signal),
        detail(base, "worksheet", job.signal),
        ...worst.map((path) => detail(base!, "legs", job.signal, path)),
      ] as const);
      if (!job.signal.aborted)
        setSheet({
          overview: base,
          inputs,
          elements,
          worksheet,
          worstLegs,
          legs: worstLegs[0] ?? null,
        });
      return job.signal.aborted ? null : base;
    } catch (cause) {
      if (!job.signal.aborted) {
        try {
          if (cause instanceof StaleSheet && base) await recoverStale(base, job.signal);
          else setError(message(cause));
        } catch (failure) {
          if (!job.signal.aborted) setError(message(failure));
        }
      }
    } finally {
      if (!job.signal.aborted) setBusy(false);
    }
    return null;
  };
  const pickPath = async (pathId: string) => {
    if (!sheet || busy || batchJob.current) return;
    const base = sheet.overview;
    detailJob.current?.abort();
    const job = new AbortController();
    detailJob.current = job;
    setBusy(true);
    setError(null);
    setSheet((current) => current && { ...current, legs: null });
    try {
      const legs = await detail(base, "legs", job.signal, pathId);
      if (!job.signal.aborted) setSheet((current) => current && { ...current, legs });
    } catch (cause) {
      if (!job.signal.aborted) {
        try {
          if (cause instanceof StaleSheet) await recoverStale(base, job.signal);
          else setError(message(cause));
        } catch (failure) {
          if (!job.signal.aborted) setError(message(failure));
        }
      }
    } finally {
      if (!job.signal.aborted) setBusy(false);
    }
  };
  const computeAll = async () => {
    if (busy || batchJob.current) return;
    const job = new AbortController();
    batchJob.current = job;
    setBusy(true);
    setError(null);
    setSheet(null);
    const fans = [...rows];
    let done = 0;
    try {
      for (const fan of fans) {
        if (job.signal.aborted) break;
        setProgress({ done, total: fans.length, mark: fan.mark, stopped: false });
        await overview(fan, job.signal);
        if (!job.signal.aborted)
          setProgress({ done: ++done, total: fans.length, mark: fan.mark, stopped: false });
      }
    } catch (cause) {
      if (!job.signal.aborted) setError(message(cause));
    } finally {
      if (batchJob.current === job) {
        batchJob.current = null;
        setBusy(false);
        setProgress({ done, total: fans.length, mark: "", stopped: job.signal.aborted });
      }
    }
  };
  const cancel = () => {
    batchJob.current?.abort();
    detailJob.current?.abort();
    if (!batchJob.current) setBusy(false);
  };
  return {
    rows,
    slots,
    activeSlot,
    /** The open fan's overview after the edit lands; null when it failed or was cancelled. */
    changeInputs: (edits: DuctsSheetEdits) =>
      sheet?.overview.fan ? compute(sheet.overview.fan, edits) : Promise.resolve(null),
    ruleProposal: (proposal: NonNullable<DuctsSheetRequest["proposal"]>) =>
      sheet?.overview.fan ? compute(sheet.overview.fan, undefined, proposal) : Promise.resolve(null),
    /** Reprice the open fan over Work as it stands (after a Work write made elsewhere), roster included. */
    recompute: () =>
      sheet?.overview.fan ? compute(sheet.overview.fan, undefined, undefined, true) : Promise.resolve(null),
    sheet,
    error,
    loading,
    busy,
    progress,
    refresh,
    compute,
    computeAll,
    pickPath,
    cancel,
  };
}
