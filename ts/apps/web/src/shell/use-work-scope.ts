/**
 * The kernel's one Target/Work door (ADR 0026): URL carry -> machine inventory -> exact document ->
 * Work key -> Work document, as the old kernel resolves them, published as the graph mount's
 * immutable external-store ports plus its host write ports. Routes never supply these.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  bindWork,
  type RouteGraph,
  type RouteStateSpec,
  type RouteStateWriteResult,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { previousOf } from "#/readings";
import { useRouteSearchSlice } from "../route/activity";
import { subscribeAcceptedDeltas, writeRouteWork } from "../route/host";
import { appAtomRegistry, useOwned } from "../route/route-owner";
import { useRouteTarget } from "../route/route-target";
import { docAtom } from "../route/route-work";
import type { MountScope } from "./mount-owner";

const CLOSED_WORK = "its document is closed; this Work only reads";
const refused = (error: string, hint: string): RouteStateWriteResult => ({
  ok: false,
  kind: "refused",
  error,
  hint,
});
const noWork = async () => refused("This route has no Work", "Edit Page fields instead");
const noDeltas = () => () => {};
// A synthetic seed is useRouteTarget's no-read branch: host Target, no inventory or machine reading.
const HOST_ONLY = {};

export type WorkScopeStatus = Pick<
  ReturnType<typeof useRouteTarget>,
  "resolution" | "bindingLost" | "targetProvenance"
> & {
  /** Readable Work whose document is not live: shown, never armed (no writer, no verb). */
  closed: boolean;
};
export interface WorkScopePorts<W> {
  getSnapshot(): MountScope<W>;
  subscribe(notify: () => void): () => void;
  write(key: WorkKey, write: WorkWrite): Promise<RouteStateWriteResult>;
  subscribeAcceptedDeltas(key: WorkKey, onAck: (ack: WorkWriteAck) => void): () => void;
  status: WorkScopeStatus;
}

export function useWorkScope<P, W>(graph: RouteGraph<P, W>): WorkScopePorts<W> {
  const carry = useRouteSearchSlice((search) => ({ target: search.target, work: search.work }));
  const target = useRouteTarget(
    { needs: graph.needs },
    appAtomRegistry,
    graph.needs ? undefined : HOST_ONLY,
    carry.target ?? null,
  );
  const { resolvedAddress, workAddress, workOpen } = target;
  // useRouteTarget answers fresh objects on some renders; the ports change only when their JSON does.
  const statusText = JSON.stringify([
    target.resolution,
    target.bindingLost,
    target.targetProvenance,
  ]);
  const resolution = useMemo(() => target.resolution, [statusText]); // eslint-disable-line react-hooks/exhaustive-deps
  const closed =
    !!graph.needs && ((workAddress !== null && resolvedAddress === null) || !!workOpen);
  const bound =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : undefined;
  const keyText = JSON.stringify(
    bindWork(graph.key, workAddress, carry.work, bound ?? workOpen ?? undefined),
  );
  const key = useMemo(() => JSON.parse(keyText) as WorkKey, [keyText]);
  const spec = useMemo(
    (): RouteStateSpec<NonNullable<typeof graph.work>> | null =>
      graph.work
        ? { route: graph.key, title: graph.name, description: graph.name, schema: graph.work }
        : null,
    [graph],
  );
  // Target-owned Work never falls back to the shared host key while its document is unresolved.
  const readable = carry.work !== undefined || workAddress !== null || key.binding === "open";
  const atom = useMemo(() => (spec && readable ? docAtom(spec, key) : null), [spec, readable, key]);
  const reading = useOwned(appAtomRegistry, atom);
  const snapshot = useMemo((): MountScope<W> => {
    const seen = reading ? previousOf(reading) : undefined;
    // Absent Work is the empty document at revision 0; only an authored write creates it.
    const empty = seen && seen.doc === null ? graph.work?.safeParse({}) : undefined;
    const doc = seen?.doc ?? (empty?.success ? empty.data : undefined);
    return {
      target: resolution.kind === "resolved" ? resolution.target : { kind: "host" },
      work:
        seen && doc !== undefined ? { handle: { key, revision: seen.revision ?? 0 }, doc } : null,
    };
  }, [resolution, key, reading, graph]);
  // The mount captures its ports once; they read this store, so they never go stale.
  const store = useRef({ snapshot, closed, lost: "", listeners: new Set<() => void>() }).current;
  Object.assign(store, { snapshot, closed, lost: target.bindingLost?.sentence ?? CLOSED_WORK });
  useEffect(() => {
    for (const notify of store.listeners) notify();
  }, [store, snapshot]);
  const ports = useMemo(
    () => ({
      getSnapshot: () => store.snapshot,
      subscribe: (notify: () => void) => {
        store.listeners.add(notify);
        return () => {
          store.listeners.delete(notify);
        };
      },
      write: spec
        ? (key: WorkKey, write: WorkWrite) =>
            store.closed
              ? Promise.resolve(refused(store.lost, "Choose the document again to edit its Work"))
              : writeRouteWork(key, write)
        : noWork,
      subscribeAcceptedDeltas: spec
        ? (key: WorkKey, onAck: (ack: WorkWriteAck) => void) => subscribeAcceptedDeltas(key, onAck)
        : noDeltas,
    }),
    [store, spec],
  );
  const status = useMemo(
    (): WorkScopeStatus => ({
      resolution,
      bindingLost: target.bindingLost,
      targetProvenance: target.targetProvenance,
      closed,
    }),
    [statusText, closed], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return useMemo(() => ({ ...ports, status }), [ports, status]);
}
