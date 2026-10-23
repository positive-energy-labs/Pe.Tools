/**
 * The one place /ducts reaches the host: the `ducts.snapshot` and `ducts.tables` reads, and the
 * snapshot's dev-only saved source.
 * `PE_DUCTS_FIXTURE=<snapshot.json>` at `vp dev` (vite.config.ts) makes the route read a saved
 * snapshot instead of the host, so a view can be built with no Revit.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DuctParameterKey } from "@pe/agent-contracts";

import { hostFetch } from "#/host/runtime";
import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";
import { useDuctsReading } from "#/readings";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import { toGrids, type Grids } from "@pe/ducts-domain/loss-grid";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** The saved snapshot's URL in dev, else undefined. */
export const SAVED: string | undefined = import.meta.env.DEV
  ? (import.meta.env.VITE_DUCTS_FIXTURE as string | undefined) || undefined
  : undefined;

function useSaved(epoch: number) {
  // `at` is the epoch the data answers: a refresh keeps the last data and reads as pending.
  const [state, setState] = useState<{ data?: DuctSnapshot; error?: string; at?: number }>({});
  useEffect(() => {
    if (!SAVED) return;
    let live = true;
    fetch(SAVED)
      .then((response) => (response.ok ? response.json() : Promise.reject(`${response.status}`)))
      .then(
        (data: DuctSnapshot) => live && setState({ data, at: epoch }),
        (error: unknown) =>
          live && setState({ error: `saved snapshot ${SAVED}: ${String(error)}`, at: epoch }),
      );
    return () => {
      live = false;
    };
  }, [epoch]);
  return {
    snapshot: state.data ?? null,
    error: state.error ?? null,
    pending: state.at !== epoch,
    nativeObservation: undefined,
    version: undefined,
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
  const call = useDuctsReading<DuctSnapshot>(
    doc && !SAVED ? { kind: "ducts-snapshot", target: doc, ...request } : null,
  );
  // A new target is a new request (its deps change); a refresh reads again.
  const { refresh } = call;
  const previousEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch !== previousEpoch.current) {
      previousEpoch.current = epoch;
      refresh();
    }
  }, [epoch, refresh]);
  const saved = useSaved(epoch);
  if (SAVED) return saved;
  return {
    snapshot: call.data ?? null,
    error: call.error?.message ?? null,
    pending: call.pending,
    nativeObservation: call.nativeObservation,
    version: call.version,
  };
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
  const call = useDuctsReading<HostOpResponse<"ducts.tables">>(
    session && !SAVED ? { kind: "ducts-tables", session, ids: [...TABLE_IDS] } : null,
  );
  const saved = useSavedTables();
  const data = SAVED ? saved.data : call.data;
  const grids = useMemo(() => {
    if (!data) return { grids: null, error: null };
    try {
      const version = call.version;
      let grids = version ? decodedGrids.get(version) : undefined;
      if (!grids) {
        grids = toGrids(data);
        if (version) {
          decodedGrids.set(version, grids);
          if (decodedGrids.size > 8) decodedGrids.delete(decodedGrids.keys().next().value!);
        }
      }
      return { grids, error: null };
    } catch (error) {
      return { grids: null, error: String(error) };
    }
  }, [data, call.version]);
  return {
    grids: grids.grids as Grids | null,
    missing: call.data?.missing ?? [],
    unsupported: call.data?.unsupported ?? {},
    error: grids.error ?? saved.error ?? call.error?.message ?? null,
    pending: SAVED ? !saved.data && !saved.error : call.pending,
    nativeObservation: call.nativeObservation,
  };
}

/** The installed table decode is reusable across route unmounts; native body ownership stays host-side. */
const decodedGrids = new Map<string, Grids>();

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
