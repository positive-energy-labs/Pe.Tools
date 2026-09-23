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
} from "@pe/agent-contracts";
import { Equal, Hash, Option } from "effect";
import { dirty, mapReading, readingAtom, peReadings, previousOf, type Readings } from "#/readings";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";
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

function routeUrl(
  route: string,
  operation: "apply" | "command" | typeof START_FRESH | "salvage",
  key: WorkKey,
) {
  const url = new URL(peUrl(resolveWorkbenchConfig(), `/route-state/${route}/${operation}`));
  if (key.work !== undefined) url.searchParams.set("work", key.work);
  else {
    if (key.target !== null) url.searchParams.set("target", key.target);
    const open = key.binding === "address" ? key.from : key.open;
    if (open) url.searchParams.set("open", `${open.session}/${open.openId}`);
  }
  return url.toString();
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
    operation: "apply" | "command" | typeof START_FRESH,
    body: Record<string, unknown> & { expectedRevision?: number },
    onAccepted?: (base: number, revision: number) => void,
  ): Promise<Refusal | null> => {
    try {
      const { status, result } = await postRouteWrite(routeUrl(spec.route, operation, key), body);
      if (!result) return refuse("failed", `${operation} failed (${status})`);
      if (!result.ok && result.code === "stale_revision" && conflict) registry.set(conflict, true);
      if (result.ok && body.expectedRevision !== undefined)
        onAccepted?.(body.expectedRevision, result.revision);
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
      onAccepted?: (base: number, revision: number) => void,
    ) => {
      const revision = writeRevision(expectedRevision);
      if (revision === null) return Promise.resolve(notHydrated);
      return send("apply", { patches, expectedRevision: revision }, onAccepted);
    },
    command: (
      name: keyof S["commands"] & string,
      input?: unknown,
      expectedRevision?: number,
      onAccepted?: (base: number, revision: number) => void,
    ) => {
      const revision = writeRevision(expectedRevision);
      return revision === null
        ? Promise.resolve(notHydrated)
        : send(
            "command",
            { command: name, input: input ?? {}, expectedRevision: revision },
            onAccepted,
          );
    },
    /** The human door only; the host refuses Pea's door and readable Work. */
    startFresh: () => send(START_FRESH, {}),
    /** The human door only: what the route carries over from Work it can no longer read. */
    salvage: () => getRouteSalvage(routeUrl(spec.route, "salvage", key)),
  };
}

/**
 * One route's Work read and written by key, with no route owner: the Chat head's summary of Work
 * the thread's document holds. It reads the same Work atom a mounted route (the plugin pane) reads,
 * so both re-render from one Work; its writes are foreign to that route's own-write chain, so a
 * bound write either side refuses truthfully when the other landed first.
 */
export function useRouteWork<S extends RouteStateSpec<any>>(spec: S, key: WorkKey | null) {
  const id = key ? JSON.stringify(key) : null;
  const slice = useMemo(
    () => (key ? docAtom(spec, key, peReadings) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is identified by its JSON
    [spec, id],
  );
  const reading = useOwned(appAtomRegistry, slice);
  const writer = useMemo(
    () => (key && slice ? docWriter(spec, key, appAtomRegistry, slice, undefined) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is identified by its JSON
    [spec, slice],
  );
  const current = reading ? previousOf(reading) : undefined;
  return {
    doc: (current?.doc ?? null) as RouteDocOf<S> | null,
    revision: current?.revision ?? null,
    stale: reading?.state === "stale",
    write: (patches: RouteStatePatch[], expectedRevision?: number) =>
      writer ? writer.apply(patches, expectedRevision) : Promise.resolve(notHydrated),
    reload: () => {
      if (key) dirty({ ...key, kind: "work" });
    },
  };
}
