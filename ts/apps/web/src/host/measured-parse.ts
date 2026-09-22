import { useCallback, useEffect, useRef } from "react";

import { type DisplayUnit, type MeasuredValue, unitWord } from "#/components/lang/cell";
import { callHostRpc, type HostCallOptions } from "#/host/client";

export type MeasuredAnswer = MeasuredValue | { refusal: string } | null;

/**
 * The measured cell's one call, owned by the Reading it was typed against. `basis` is whatever
 * identifies that Reading: when it changes — a re-read — every parse still in flight is aborted and
 * answers null, so a value read against the old Reading can never be staged against the new one.
 * The typed text is never kept; only what Revit said comes back.
 */
export function useMeasuredParse(basis: unknown, scope?: HostCallOptions) {
  const running = useRef<AbortController>(new AbortController());
  useEffect(() => {
    running.current = new AbortController();
    const started = running.current;
    return () => started.abort();
  }, [basis]);
  return useCallback(
    async (displayUnit: DisplayUnit | null | undefined, text: string): Promise<MeasuredAnswer> => {
      const word = displayUnit?.typeId ? unitWord(displayUnit) : null;
      if (!displayUnit?.typeId || word === null)
        return { refusal: "type a unit — this column shows no unit of its own" };
      const signal = running.current.signal;
      const answer = await callHostRpc(
        "revit.resolve.unit-value",
        { spec: displayUnit.specTypeId, unit: displayUnit.typeId, text },
        { ...scope, signal },
      ).catch((error: unknown) => {
        if (signal.aborted) return null;
        throw error;
      });
      if (answer == null) return null;
      return answer.ok && answer.text != null
        ? { value: answer.text, unit: word }
        : { refusal: answer.refusal ?? `Revit could not read "${text}" here.` };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref is re-armed by `basis` above
    [scope?.bridgeSessionId, scope?.openDocumentId],
  );
}
