/**
 * The one place /ducts reaches the host: the `ducts.snapshot` and `ducts.tables` reads, and the
 * snapshot's dev-only saved source.
 * `PE_DUCTS_FIXTURE=<snapshot.json>` at `vp dev` (vite.config.ts) makes the route read a saved
 * snapshot instead of the host, so a view can be built with no Revit.
 */
import { useEffect, useMemo, useState } from "react";
import type { DuctParameterKey } from "@pe/agent-contracts";

import { useHostOp } from "#/readings";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { toGrids, type Grids } from "./loss-grid";
import { TABLE_IDS } from "./pricing";
import type { DuctSnapshot } from "./readiness";

/** The saved snapshot's URL in dev, else undefined. */
export const SAVED: string | undefined = import.meta.env.DEV
  ? (import.meta.env.VITE_DUCTS_FIXTURE as string | undefined) || undefined
  : undefined;

function useSaved(epoch: number) {
  const [state, setState] = useState<{ data?: DuctSnapshot; error?: string }>({});
  useEffect(() => {
    if (!SAVED) return;
    let live = true;
    fetch(SAVED)
      .then((response) => (response.ok ? response.json() : Promise.reject(`${response.status}`)))
      .then(
        (data: DuctSnapshot) => live && setState({ data }),
        (error: unknown) =>
          live && setState({ error: `saved snapshot ${SAVED}: ${String(error)}` }),
      );
    return () => {
      live = false;
    };
  }, [epoch]);
  return {
    snapshot: state.data ?? null,
    error: state.error ?? null,
    pending: !state.data && !state.error,
  };
}

/**
 * `ducts.snapshot` of the one document the sentence names, read again when the subject changes.
 * `slots` are the person's staged parameter names; an absent slot reads the op's default.
 */
export function useDuctSnapshot(
  doc: { session: string; openId: string } | null,
  epoch: number,
  group: string,
  slots: Partial<Record<DuctParameterKey, string>> = {},
) {
  const call = useHostOp("ducts.snapshot", Object.keys(slots).length ? { slots } : {}, {
    bridgeSessionId: doc?.session,
    openDocumentId: doc?.openId,
    enabled: doc !== null && !SAVED,
    waitSeconds: NATIVE_READ_WAIT_S,
  });
  // A new target is a new request (its deps change); a new subject or a refresh reads again.
  const { refresh } = call;
  useEffect(() => {
    if (epoch > 0 || group) refresh();
  }, [epoch, group, refresh]);
  const saved = useSaved(epoch);
  if (SAVED) return saved;
  return { snapshot: call.data ?? null, error: call.error?.message ?? null, pending: call.pending };
}

/** Revit's shipped ASHRAE grids for every table a loss rule may name; needs a session, no document. */
export function useDuctTables(session: string | null) {
  const call = useHostOp(
    "ducts.tables",
    { ids: [...TABLE_IDS] },
    {
      bridgeSessionId: session ?? undefined,
      enabled: session !== null,
      waitSeconds: NATIVE_READ_WAIT_S,
    },
  );
  const grids = useMemo(() => {
    if (!call.data) return { grids: null, error: null };
    try {
      return { grids: toGrids(call.data), error: null };
    } catch (error) {
      return { grids: null, error: String(error) };
    }
  }, [call.data]);
  return {
    grids: grids.grids as Grids | null,
    missing: call.data?.missing ?? [],
    unsupported: call.data?.unsupported ?? {},
    error: grids.error ?? call.error?.message ?? null,
    pending: call.pending,
  };
}
