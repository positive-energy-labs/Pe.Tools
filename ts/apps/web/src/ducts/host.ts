/**
 * The one place /ducts reaches the host: the `ducts.snapshot` read, and its dev-only saved source.
 * `PE_DUCTS_FIXTURE=<snapshot.json>` at `vp dev` (vite.config.ts) makes the route read a saved
 * snapshot instead of the host, so a view can be built with no Revit.
 */
import { useEffect, useState } from "react";

import { useHostOp } from "#/readings";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
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

/** `ducts.snapshot` of the one document the sentence names, read again when the subject changes. */
export function useDuctSnapshot(
  doc: { session: string; openId: string } | null,
  epoch: number,
  group: string,
) {
  const call = useHostOp(
    "ducts.snapshot",
    {},
    {
      bridgeSessionId: doc?.session,
      openDocumentId: doc?.openId,
      enabled: doc !== null && !SAVED,
      waitSeconds: NATIVE_READ_WAIT_S,
    },
  );
  // A new target is a new request (its deps change); a new subject or a refresh reads again.
  const { refresh } = call;
  useEffect(() => {
    if (epoch > 0 || group) refresh();
  }, [epoch, group, refresh]);
  const saved = useSaved(epoch);
  if (SAVED) return saved;
  return { snapshot: call.data ?? null, error: call.error?.message ?? null, pending: call.pending };
}
