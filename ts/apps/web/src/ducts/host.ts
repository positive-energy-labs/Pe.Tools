/**
 * The one place /ducts reaches the host: the `ducts.snapshot` and `ducts.tables` reads, and the
 * snapshot's dev-only saved source.
 * `PE_DUCTS_FIXTURE=<snapshot.json>` at `vp dev` (vite.config.ts) makes the route read a saved
 * snapshot instead of the host, so a view can be built with no Revit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DuctParameterKey, DuctsSnapshotSelector } from "@pe/agent-contracts";

import { hostFetch } from "#/host/runtime";
import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";
import { useDuctsReading } from "#/readings";
import type { HostOpResponse } from "@pe/host-contracts/operation-types";
import { toGrids, type Grids } from "@pe/ducts-domain/loss-grid";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { mergeSnapshots, nextSystemsRead } from "./system-reads";

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
          live &&
          setState((previous) => ({
            ...previous,
            error: `saved snapshot ${SAVED}: ${String(error)}`,
            at: epoch,
          })),
      );
    return () => {
      live = false;
    };
  }, [epoch]);
  return {
    snapshot: state.data ?? null,
    error: state.error ?? null,
    pending: state.at !== epoch,
    current: state.at === epoch && state.data !== undefined && !state.error,
    staleReason: "dirtied" as const,
    nativeObservation: undefined,
    version: undefined,
  };
}

/**
 * `ducts.snapshot` of the one document the sentence names; the request carries no group, so a new
 * subject group does not read it again. A refresh (`epoch`) does.
 * `slots` are the person's edit parameter names; an absent slot reads the op's default.
 * `labelParameter` is the edit instance parameter whose value becomes each node's `label`; none reads the firm tag PE_G___TagInstance.
 */
export function useDuctSnapshot(
  doc: { session: string; openId: string } | null,
  epoch: number,
  slots: Partial<Record<DuctParameterKey, string>> = {},
  labelParameter: string | null = null,
  /** Absent reads the whole document; the fan sheet reads only what its open fan touches (`ids`). */
  selector: DuctsSnapshotSelector | null = null,
) {
  const request = {
    ...(Object.keys(slots).length ? { slots } : {}),
    ...(labelParameter ? { labelParameter } : {}),
    ...(selector ? { selector } : {}),
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
    snapshot: call.data ?? call.previous ?? null,
    error: call.error?.message ?? null,
    pending: call.pending,
    current: call.data !== undefined && !call.error,
    staleReason: call.staleReason,
    nativeObservation: call.nativeObservation,
    version: call.version,
  };
}

type SystemsPart = {
  ids: number[];
  snapshot: DuctSnapshot;
  version: string;
  epoch: number;
  observation: ReturnType<typeof useDuctsReading>["nativeObservation"];
};
const NO_PARTS: ReadonlyMap<string, SystemsPart> = new Map();

/**
 * The network stage's read: `systems` reads of the `wanted` Revit system ids, one read of at most
 * SYSTEMS_PER_READ systems at a time, joined into one snapshot (`system-reads.ts`). A read stays
 * read while the document, slots and label parameter hold, so closing a system keeps its groups and
 * reopening it reads nothing. A refresh (`epoch`) reads every read system again; until it has, the
 * last reads stay drawn and `current` is false.
 */
export function useSystemsSnapshot(
  doc: { session: string; openId: string } | null,
  epoch: number,
  slots: Partial<Record<DuctParameterKey, string>>,
  labelParameter: string | null,
  wanted: readonly number[],
) {
  const scope = doc ? JSON.stringify([doc.session, doc.openId, slots, labelParameter]) : null;
  const [parts, setParts] = useState<{ scope: string | null; byIds: Map<string, SystemsPart> }>({
    scope: null,
    byIds: new Map(),
  });
  const byIds = parts.scope === scope ? parts.byIds : NO_PARTS;
  const read = useMemo(
    () =>
      new Set([...byIds.values()].filter((p) => p.epoch === epoch).flatMap((p) => p.ids)),
    [byIds, epoch],
  );
  const wantedKey = wanted.join(",");
  // A refresh reads the read systems again behind the wanted ones, so the drawing never thins.
  const batch = useMemo(
    () =>
      nextSystemsRead(
        [...wanted, ...[...byIds.values()].flatMap((p) => p.ids)],
        read,
      ),
    [wantedKey, byIds, read], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const batchKey = batch.join(",");
  const call = useDuctsReading<DuctSnapshot>(
    doc && batch.length
      ? {
          kind: "ducts-snapshot",
          target: doc,
          ...(Object.keys(slots).length ? { slots } : {}),
          ...(labelParameter ? { labelParameter } : {}),
          selector: { kind: "systems", systemIds: batch },
        }
      : null,
  );
  // The host keeps a body until it is refreshed: a body this route took before the refresh is
  // read again once, never taken as the refresh's answer.
  const taken = useRef(new Map<string, { version: string; epoch: number }>());
  const refreshed = useRef(new Set<string>());
  const { refresh } = call;
  const refreshOnce = useCallback(() => {
    const key = `${scope}|${batchKey}|${epoch}`;
    if (refreshed.current.has(key)) return;
    refreshed.current.add(key);
    refresh();
  }, [scope, batchKey, epoch, refresh]);
  const previousEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch === previousEpoch.current) return;
    previousEpoch.current = epoch;
    if (batch.length) refreshOnce();
  }, [epoch, batch.length, refreshOnce]);
  useEffect(() => {
    if (!scope || !batch.length || call.data === undefined || !call.version) return;
    const key = `${scope}|${batchKey}`;
    const prior = taken.current.get(key);
    if (prior && prior.epoch !== epoch && prior.version === call.version) return refreshOnce();
    taken.current.set(key, { version: call.version, epoch });
    const part = {
      ids: batch,
      snapshot: call.data,
      version: call.version,
      epoch,
      observation: call.nativeObservation,
    };
    setParts((previous) => {
      const next = new Map(previous.scope === scope ? previous.byIds : NO_PARTS);
      // A part this one rereads in full is replaced, never joined beside it.
      for (const [k, p] of next) if (p.ids.every((id) => batch.includes(id))) next.delete(k);
      next.set(batchKey, part);
      return { scope, byIds: next };
    });
  }, [call.data, call.version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Older reads first, so a fresher read's copy of a shared group wins.
  const ordered = useMemo(
    () => [...byIds.values()].sort((a, b) => a.epoch - b.epoch),
    [byIds],
  );
  const snapshot = useMemo(() => mergeSnapshots(ordered.map((p) => p.snapshot)), [ordered]);
  const stale = ordered.some((p) => p.epoch !== epoch);
  return {
    snapshot,
    /** The wanted and earlier-read system ids answered under this refresh. */
    read,
    /** The system ids being read now; empty when every wanted system is read. */
    reading: batch,
    error: call.error?.message ?? null,
    pending: batch.length > 0 && !call.error,
    current: snapshot !== null && !stale && !call.error,
    staleReason: call.staleReason,
    nativeObservation: ordered.at(-1)?.observation,
    // Geometry keys on this: any part read again is a new version.
    version: ordered.length ? ordered.map((p) => p.version).join("+") : undefined,
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
