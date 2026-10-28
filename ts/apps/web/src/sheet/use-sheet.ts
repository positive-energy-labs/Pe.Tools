import { useEffect, useRef, useState } from "react";
import type {
  DocumentRef,
  DuctsSheetOverview,
  DuctsSheetInputs,
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
    inputs?: DuctsSheetInputs,
    proposal?: DuctsSheetRequest["proposal"],
    basis?: string,
  ) => {
    const result = await readSheet(
      {
        target,
        mode: "fan",
        unitId: fan.unitId,
        portIndex: fan.portIndex,
        inputs,
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
  const detail = async <K extends "inputs" | "elements" | "legs">(
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
    edits?: DuctsSheetInputs,
    proposal?: DuctsSheetRequest["proposal"],
  ) => {
    if (batchJob.current) return;
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
      if (edits?.slot) {
        setActiveSlot(edits.slot);
        const roster = await readRoster(target, job.signal);
        if (!job.signal.aborted) {
          setRows(roster.rows);
          setSlots(roster.slots);
        }
      }
      if (job.signal.aborted) return;
      setSheet(blank(base));
      const worst = (["supply", "return"] as const).flatMap((side) =>
        base!.totals?.[side].complete && base!.paths[side].paths[0]
          ? [base!.paths[side].paths[0]!.pathId]
          : [],
      );
      const [inputs, elements, ...worstLegs] = await Promise.all([
        detail(base, "inputs", job.signal),
        detail(base, "elements", job.signal),
        ...worst.map((path) => detail(base!, "legs", job.signal, path)),
      ] as const);
      if (!job.signal.aborted)
        setSheet({ overview: base, inputs, elements, worstLegs, legs: worstLegs[0] ?? null });
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
    changeInputs: (inputs: DuctsSheetInputs) =>
      sheet?.overview.fan ? compute(sheet.overview.fan, inputs) : Promise.resolve(),
    ruleProposal: (proposal: NonNullable<DuctsSheetRequest["proposal"]>) =>
      sheet?.overview.fan ? compute(sheet.overview.fan, undefined, proposal) : Promise.resolve(),
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
