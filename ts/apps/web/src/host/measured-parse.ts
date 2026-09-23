import { useCallback, useEffect, useRef } from "react";

import type { MeasuredDisplayUnit, MeasuredValue } from "@pe/agent-contracts";

import { unitWord } from "#/components/lang/cell";
import { callHostRpc, type HostCallOptions } from "#/host/client";

export type MeasuredAnswer = MeasuredValue | { refusal: string } | null;

/**
 * The measured cell's one call, owned by the Reading it was typed against. `basis` is whatever
 * identifies that Reading: when it changes — a re-read — every parse still in flight is aborted and
 * answers null, so a value read against the old Reading can never be staged against the new one.
 * The typed text is never kept; Revit's unrounded value in the requested unit comes back.
 */
export function useMeasuredParse(basis: unknown, scope?: HostCallOptions) {
  const running = useRef<AbortController>(new AbortController());
  useEffect(() => {
    running.current = new AbortController();
    const started = running.current;
    return () => started.abort();
  }, [basis]);
  return useCallback(
    async (
      displayUnit: MeasuredDisplayUnit | null | undefined,
      text: string,
    ): Promise<MeasuredAnswer> => {
      if (displayUnit?.refusal) return { refusal: displayUnit.refusal };
      const word = displayUnit?.typeId ? unitWord(displayUnit) : null;
      if (!displayUnit?.typeId || word === null)
        return {
          refusal:
            "Revit did not report this measured parameter's display unit, so this cell cannot be staged.",
        };
      const signal = running.current.signal;
      const answer = await callHostRpc(
        "revit.resolve.unit-value",
        { spec: displayUnit.specTypeId, unit: displayUnit.typeId, text },
        { ...scope, signal },
      ).catch((error: unknown) => {
        if (signal.aborted) return null;
        return { refusal: error instanceof Error ? error.message : String(error) };
      });
      if (answer == null) return null;
      if (!("ok" in answer)) return answer;
      return answer.ok && answer.value != null && Number.isFinite(answer.value)
        ? { value: String(answer.value), unit: word }
        : { refusal: answer.refusal ?? `Revit could not read "${text}" here.` };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref is re-armed by `basis` above
    [scope?.bridgeSessionId, scope?.openDocumentId],
  );
}
