/**
 * The one place /ducts reaches the host: the `ducts.snapshot` read, and its dev-only saved source.
 * `PE_DUCTS_FIXTURE=<bounded-reading.json>` at `vp dev` makes the route read a saved index or
 * group reading instead of the host, so that reading can be viewed with no Revit.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyPatches,
  canonicalRouteInput,
  ductsRouteState,
  type RouteEnvelope,
  type RouteStatePatch,
  type DuctsRouteDocument,
} from "@pe/agent-contracts";
import type { DuctsSnapshot } from "@pe/host-contracts/generated";

import { useHostCall } from "#/readings";
import { callHostRpc } from "#/host/client";
import { NATIVE_READ_WAIT_S } from "#/route/waits";

/** The saved snapshot's URL in dev, else undefined. */
export const SAVED: string | undefined = import.meta.env.DEV
  ? (import.meta.env.VITE_DUCTS_FIXTURE as string | undefined) || undefined
  : undefined;

function useSaved(epoch: number, request: DuctsSnapshot.Req.Request) {
  const [state, setState] = useState<{ data?: SavedDucts; error?: string }>({});
  useEffect(() => {
    if (!SAVED) return;
    let live = true;
    fetch(SAVED)
      .then((response) => (response.ok ? response.json() : Promise.reject(`${response.status}`)))
      .then(
        (data: SavedDucts) => live && setState({ data }),
        (error: unknown) =>
          live && setState({ error: `saved snapshot ${SAVED}: ${String(error)}` }),
      );
    return () => {
      live = false;
    };
  }, [epoch]);
  try {
    return {
      snapshot: state.data ? savedReading(state.data, request) : null,
      error: state.error ?? null,
      pending: !state.data && !state.error,
    };
  } catch (error) {
    return { snapshot: null, error: String(error), pending: false };
  }
}

/** `ducts.snapshot` of the one document the sentence names, read again when the subject changes. */
export function useDuctSnapshot(
  doc: { session: string; openId: string } | null,
  epoch: number,
  group: string,
  work: { doc: DuctsRouteDocument | null; revision: number | null; current: boolean },
) {
  const request: DuctsSnapshot.Req.Request = {
    ...(group ? { group } : {}),
    context: true,
    assumptions: {
      revision: work.revision ?? 0,
      values: Object.fromEntries(
        Object.entries(work.doc?.assumptions ?? {}).flatMap(([key, cell]) =>
          cell.staged ? [[key, cell.staged.value]] : [],
        ),
      ),
    },
  };
  const call = useHostCall(
    async (signal) => {
      const result = await callHostRpc("ducts.snapshot", request, {
        bridgeSessionId: doc?.session,
        openDocumentId: doc?.openId,
        signal,
      });
      if (
        result.assumptionRevision !== request.assumptions!.revision ||
        (result.group ?? "") !== group ||
        (group && result.pressure?.assumptionRevision !== request.assumptions!.revision)
      )
        throw Error("The ducts reading does not match the requested group and Work revision.");
      return result;
    },
    [doc?.session, doc?.openId, JSON.stringify(request), epoch, work.current],
    doc !== null && work.current && !SAVED,
    NATIVE_READ_WAIT_S,
  );
  const saved = useSaved(epoch, request);
  // Keep only the index while a group changes, so another group remains selectable during the read.
  // A target or Work change drops it immediately, including A -> B -> A lifetimes.
  const indexKey = JSON.stringify([doc, request.assumptions, work.current]);
  const index = useRef<{ key: string; data?: DuctsSnapshot.Res.Response }>({ key: indexKey });
  if (index.current.key !== indexKey) index.current = { key: indexKey };
  if (call.data) {
    const { document, levels, layers, groups, assumptionRevision } = call.data;
    index.current.data = { document, levels, layers, groups, assumptionRevision };
  }
  const data = SAVED
    ? saved.snapshot
    : (call.data ?? (call.pending ? index.current.data : undefined));
  const snapshot = useMemo(
    () =>
      data
        ? {
            ...data,
            nodes: data.nodes ?? [],
            segments: data.segments ?? [],
            flows: data.flows ?? [],
            issues: data.issues ?? [],
          }
        : null,
    [data],
  );
  return {
    snapshot,
    error: SAVED ? saved.error : (call.error?.message ?? null),
    pending: SAVED ? saved.pending : call.pending,
  };
}

export function useSavedWork(group: string) {
  const [state, setState] = useState<RouteEnvelope<DuctsRouteDocument>>(() => ({
    version: 1,
    revision: 0,
    doc: ductsRouteState.schema.parse({}),
  }));
  const current = useRef(state);
  return {
    ...state,
    current: true,
    write: async (patches: RouteStatePatch[]) => {
      const result = applyPatches(
        ductsRouteState,
        current.current,
        "human",
        patches,
        state.revision,
      );
      if (!result.ok) return { message: result.error };
      if (SAVED) {
        try {
          const response = await fetch(SAVED);
          if (!response.ok) throw Error(`Saved fixture returned ${response.status}`);
          savedReading(await response.json(), {
            group,
            assumptions: {
              revision: result.envelope.revision,
              values: Object.fromEntries(
                Object.entries(result.envelope.doc.assumptions).flatMap(([key, cell]) =>
                  cell.staged ? [[key, cell.staged.value]] : [],
                ),
              ),
            },
          });
        } catch (error) {
          return { message: String(error) };
        }
      }
      if (current.current.revision !== state.revision)
        return { message: "Saved Work changed while this scenario was loading; stage again." };
      current.current = result.envelope;
      setState(result.envelope);
      return null;
    },
  };
}

type Request = DuctsSnapshot.Req.Request;
type SavedResponse = DuctsSnapshot.Res.Response;
type SavedDucts =
  | SavedResponse
  | { index: SavedResponse; scenarios: { request: Request; response: SavedResponse }[] };

export function savedReading(saved: SavedDucts, request: Request): SavedResponse {
  if (!("scenarios" in saved)) {
    if (Object.keys(request.assumptions?.values ?? {}).length)
      throw Error("This saved reading has no staged pressure scenarios.");
    return saved;
  }
  if (!request.group) return saved.index;
  const values = canonicalRouteInput(request.assumptions?.values ?? {});
  const match = saved.scenarios.find(
    (s) =>
      s.request.group === request.group &&
      canonicalRouteInput(s.request.assumptions?.values ?? {}) === values,
  );
  if (!match)
    throw Error(
      `No saved pressure scenario matches ${request.group} and these staged values. Unset them or generate this scenario with DuctSnapshotReader.`,
    );
  // Revisions are publication fences. The numerical result and dependency sources remain the saved C# solve.
  return {
    ...match.response,
    assumptionRevision: request.assumptions?.revision,
    pressure: match.response.pressure
      ? { ...match.response.pressure, assumptionRevision: request.assumptions?.revision }
      : undefined,
  };
}
