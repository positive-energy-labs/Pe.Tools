/**
 * The one place /ducts reaches the host: the `ducts.snapshot` and `ducts.tables` reads, and the
 * snapshot's dev-only saved source.
 * `PE_DUCTS_FIXTURE=<snapshot.json>` at `vp dev` (vite.config.ts) makes the route read a saved
 * snapshot instead of the host, so a view can be built with no Revit.
 */
import { useEffect, useMemo, useState } from "react";
import type { DuctParameterKey } from "@pe/agent-contracts";

import { hostFetch } from "#/host/runtime";
import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";
import { useHostOp } from "#/readings";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { toGrids, type Grids } from "@pe/ducts-domain/loss-grid";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

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
 * `ducts.snapshot` of the one document the sentence names; the request carries no group, so a new
 * subject group does not read it again. A refresh (`epoch`) does.
 * `slots` are the person's staged parameter names; an absent slot reads the op's default.
 * `labelParameter` is the staged instance parameter whose value becomes each node's `label`; none reads the firm tag PE_G___TagInstance.
 */
export function useDuctSnapshot(
  doc: { session: string; openId: string } | null,
  epoch: number,
  slots: Partial<Record<DuctParameterKey, string>> = {},
  labelParameter: string | null = null,
) {
  const request = {
    ...(Object.keys(slots).length ? { slots } : {}),
    ...(labelParameter ? { labelParameter } : {}),
  };
  const call = useHostOp("ducts.snapshot", request, {
    bridgeSessionId: doc?.session,
    openDocumentId: doc?.openId,
    enabled: doc !== null && !SAVED,
    waitSeconds: NATIVE_READ_WAIT_S,
  });
  // A new target is a new request (its deps change); a refresh reads again.
  const { refresh } = call;
  useEffect(() => {
    if (epoch > 0) refresh();
  }, [epoch, refresh]);
  const saved = useSaved(epoch);
  if (SAVED) return saved;
  return { snapshot: call.data ?? null, error: call.error?.message ?? null, pending: call.pending };
}

/** In dev with a saved snapshot, the grids come from its sibling `tables.json` (a saved `ducts.tables`). */
const SAVED_TABLES = SAVED?.replace(/[^/]*$/, "tables.json");

function useSavedTables() {
  const [data, setData] = useState<{ data?: unknown; error?: string }>({});
  useEffect(() => {
    if (!SAVED_TABLES) return;
    fetch(SAVED_TABLES)
      .then((response) => (response.ok ? response.json() : Promise.reject(`${response.status}`)))
      .then(
        (data: unknown) => setData({ data }),
        (error: unknown) => setData({ error: `saved tables ${SAVED_TABLES}: ${String(error)}` }),
      );
  }, []);
  return data;
}

/** Revit's shipped ASHRAE grids for every table a loss rule may name; needs a session, no document. */
export function useDuctTables(session: string | null) {
  const call = useHostOp(
    "ducts.tables",
    { ids: [...TABLE_IDS] },
    {
      bridgeSessionId: session ?? undefined,
      enabled: session !== null && !SAVED,
      waitSeconds: NATIVE_READ_WAIT_S,
    },
  );
  const saved = useSavedTables();
  const data = SAVED ? saved.data : call.data;
  const grids = useMemo(() => {
    if (!data) return { grids: null, error: null };
    try {
      return { grids: toGrids(data), error: null };
    } catch (error) {
      return { grids: null, error: String(error) };
    }
  }, [data]);
  return {
    grids: grids.grids as Grids | null,
    missing: call.data?.missing ?? [],
    unsupported: call.data?.unsupported ?? {},
    error: grids.error ?? saved.error ?? call.error?.message ?? null,
    pending: SAVED ? !saved.data && !saved.error : call.pending,
  };
}

/** Portable catalog tables are host files, independent of Revit's ASHRAE grids. */
export function useDuctCatalogs(epoch: number) {
  const [state, setState] = useState<{ tables: Catalogs; findings: string[] }>({
    tables: EMPTY_CATALOGS,
    findings: [],
  });
  useEffect(() => {
    let live = true;
    hostFetch("/pe/ducts/catalogs")
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then(
        (value) => {
          if (live) setState(value);
        },
        (error) => {
          if (live)
            setState({
              tables: EMPTY_CATALOGS,
              findings: [`Catalog read failed: ${String(error)}`],
            });
        },
      );
    return () => {
      live = false;
    };
  }, [epoch]);
  return state;
}
