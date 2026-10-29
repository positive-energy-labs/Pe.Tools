/** A route's Work: the atom family over the host document, and the writer it hands the hook. */
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { useMemo } from "react";
import {
  parseRouteDoc,
  START_FRESH,
  workKey,
  type Reading,
  type RouteDocOf,
  type RouteStatePatch,
  type RouteStateSpec,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { Equal, Hash, Option } from "effect";
import { dirty, mapReading, readingAtom, peReadings, previousOf, type Readings } from "#/readings";
import { causeRefusal, refuse, writeRefusal, type Refusal } from "./refusal";
import { getRouteSalvage, postRouteWrite } from "./host";
import { type Slice, appAtomRegistry, isRecord, useOwned } from "./route-owner";

class RouteAtomKey implements Equal.Equal {
  constructor(
    readonly spec: RouteStateSpec<any>,
    readonly key: WorkKey,
    readonly resources: Readings,
  ) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    return (
      that instanceof RouteAtomKey &&
      this.spec.route === that.spec.route &&
      this.resources === that.resources &&
      workKey(this.key) === workKey(that.key)
    );
  }
  [Hash.symbol]() {
    return Hash.string(`${this.spec.route}\0${workKey(this.key)}`);
  }
}

function routeInput(route: string, key: WorkKey) {
  const query: Record<string, string> = {};
  if (key.work !== undefined) query.work = key.work;
  else {
    if (key.target !== null) query.target = key.target;
    const open = key.binding === "address" ? key.from : key.open;
    if (open) query.open = `${open.session}/${open.openId}`;
  }
  return { params: { route }, query };
}

const routeAtom = Atom.family((key: RouteAtomKey) => {
  const { spec } = key;
  const resource = readingAtom({ ...key.key, kind: "work" }, key.resources);
  return Atom.make((get) => {
    const result = get(resource);
    try {
      return mapReading(result, (raw): Slice<RouteDocOf<typeof spec>> => {
        if (raw === null) return { doc: null, revision: null };
        if (!isRecord(raw) || !Number.isInteger(raw.revision) || !("doc" in raw))
          throw Error("Work response has no document or revision");
        return {
          doc: parseRouteDoc(raw.doc, spec),
          revision: raw.revision as number,
        };
      });
    } catch (error) {
      const self = Option.getOrUndefined(get.self<Reading<Slice<RouteDocOf<typeof spec>>>>());
      const previous = self ? previousOf(self) : undefined;
      const failed: Reading<Slice<RouteDocOf<typeof spec>>> = {
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
        ...(previous !== undefined && { previous }),
      };
      return failed;
    }
  }).pipe(Atom.withLabel(`${spec.route}/slice`));
});

export function docAtom<S extends RouteStateSpec<any>>(
  spec: S,
  key: WorkKey,
  resources: Readings = peReadings,
): Atom.Atom<Reading<Slice<RouteDocOf<S>>>> {
  return routeAtom(new RouteAtomKey(spec, key, resources));
}

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
    salvage: () => getRouteSalvage(routeInput(spec.route, key)),
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
