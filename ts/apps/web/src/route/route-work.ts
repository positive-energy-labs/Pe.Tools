/** A route's Work: the atom family over the host document, and the writer it hands the hook. */
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { useMemo } from "react";
import { docAtom } from "#/shell/work-document";
import {
  START_FRESH,
  type Reading,
  type RouteDocOf,
  type RouteStatePatch,
  type RouteStateSpec,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { dirty, peReadings, previousOf } from "#/readings";
import { causeRefusal, refuse, writeRefusal, type Refusal } from "./refusal";
import { postRouteWrite, routeInput, salvageRouteWork } from "./host";
import { type Slice, appAtomRegistry, useOwned } from "#/shell/owner";

export const notHydrated = refuse("not-ready", "route document is not hydrated");

export function docWriter<S extends RouteStateSpec<any>>(
  spec: S,
  key: WorkKey,
  registry: AtomRegistry.AtomRegistry,
  slice: Atom.Atom<Reading<Slice<RouteDocOf<S>>>>,
  conflict: Atom.Writable<boolean> | undefined,
) {
  const send = async (
    operation: "apply" | "restore" | typeof START_FRESH,
    body: Record<string, unknown> & { expectedRevision?: number },
    onAccepted?: (base: number, revision: number, write: WorkWriteAck) => void,
  ): Promise<Refusal | null> => {
    try {
      const { status, result } = await postRouteWrite(operation, routeInput(spec.route, key), body);
      if (!result) return refuse("failed", `${operation} failed (${status})`);
      if (!result.ok && result.code === "stale_revision" && conflict) registry.set(conflict, true);
      if (result.ok) onAccepted?.(result.write.base, result.revision, result.write);
      return writeRefusal(result);
    } catch (cause) {
      return causeRefusal(cause);
    }
  };
  const writeRevision = (explicit?: number): number | null => {
    // An explicit revision is the caller's own declaration and the server arbitrates it: a queued
    // apply carries the revision its predecessor just landed, which the owner has not observed yet.
    if (explicit !== undefined) return explicit;
    const current = registry.get(slice);
    if (current.state !== "ready") return null;
    // Only an explicit authored write can initialize absent Work. Observation never creates it.
    return current.observation.revision ?? 0;
  };
  return {
    apply: (
      patches: RouteStatePatch[],
      expectedRevision?: number,
      onAccepted?: (base: number, revision: number, write: WorkWriteAck) => void,
      context: { press: string } = { press: crypto.randomUUID() },
    ) => {
      const revision = writeRevision(expectedRevision);
      if (revision === null) return Promise.resolve(notHydrated);
      return send(
        "apply",
        { patches, expectedRevision: revision, press: context.press, kind: "apply" },
        onAccepted,
      );
    },
    restore: (
      patches: RouteStatePatch[],
      expectedRevision: number,
      onAccepted?: (base: number, revision: number, write: WorkWriteAck) => void,
    ) => send("restore", { patches, expectedRevision, press: null, kind: "restore" }, onAccepted),
    /** The human door only; the host refuses Pea's door and readable Work. */
    startFresh: (onAccepted?: (base: number, revision: number, write: WorkWriteAck) => void) =>
      send(START_FRESH, {}, onAccepted),
    /** The human door only: what the route carries over from Work it can no longer read. */
    salvage: () => salvageRouteWork(key),
  };
}

/** A changing collection of Work subscriptions uses one React hook and the same per-Work atoms. */
export function useRouteWorks<S extends RouteStateSpec<any>>(
  entries: readonly { spec: S; key: WorkKey | null }[],
) {
  const sources = useMemo(
    () =>
      entries.map(({ spec, key }) => {
        const slice = key ? docAtom(spec, key, peReadings) : null;
        return {
          key,
          slice,
          writer: key && slice ? docWriter(spec, key, appAtomRegistry, slice, undefined) : null,
        };
      }),
    [entries],
  );
  const collection = useMemo(
    () => Atom.make((get) => sources.map(({ slice }) => (slice ? get(slice) : null))),
    [sources],
  );
  const readings = useOwned(appAtomRegistry, collection);
  return sources.map(({ key, writer }, index) => {
    const reading = readings?.[index];
    const current = reading ? previousOf(reading) : undefined;
    return {
      doc: (current?.doc ?? null) as RouteDocOf<S> | null,
      revision: current?.revision ?? null,
      stale: reading?.state === "stale",
      write: (patches: RouteStatePatch[], expectedRevision?: number, context?: { press: string }) =>
        writer
          ? writer.apply(patches, expectedRevision, undefined, context)
          : Promise.resolve(notHydrated),
      reload: () => {
        if (key) dirty({ ...key, kind: "work" });
      },
    };
  });
}
