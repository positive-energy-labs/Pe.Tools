import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useMemo, useReducer } from "react";
import { type RouteGraph, type RouteStatePatch, type WorkKey } from "@pe/agent-contracts";
import { dirty, previousOf } from "#/readings";
import { subscribeAcceptedDeltas, writeRouteWork } from "../route/host";
import { refuse, writeRefusal } from "../route/refusal";
import { appAtomRegistry, useOwned, useRouteOwner } from "./owner";
import { docAtom } from "./work-document";
import { acquireWorkWriter } from "./work-writes";
import type { MountScope } from "./mount-owner";

/** Cross-Work handles use the route's schema, admission and canonical journal, without mounting its UI. */
export function useWorkHandles<W>(
  entries: readonly { graph: RouteGraph<any, W>; key: WorkKey | null; closed?: boolean }[],
) {
  const [, changed] = useReducer((version: number) => version + 1, 0);
  const owner = useRouteOwner(() => {
    const sources = entries.map(({ graph, key, closed }) => ({
      graph,
      key,
      closed,
      slice:
        key && graph.work
          ? docAtom(
              {
                route: graph.key,
                title: graph.name,
                description: graph.name,
                schema: graph.work,
              },
              key,
            )
          : null,
      held: key ? acquireWorkWriter(key) : null,
    }));
    return {
      registry: appAtomRegistry,
      sources,
      dispose() {
        for (const source of sources) source.held?.release();
      },
    };
  }, entries);
  const { sources } = owner;
  const collection = useMemo(
    () => Atom.make((get) => sources.map(({ slice }) => (slice ? get(slice) : null))),
    [sources],
  );
  const readings = useOwned(appAtomRegistry, collection);
  useEffect(() => {
    const releases = sources.flatMap(({ key, held }) =>
      held && key
        ? [held.writer.subscribe(changed), subscribeAcceptedDeltas(key, held.writer.accept)]
        : [],
    );
    return () => {
      for (const release of releases.reverse()) release();
    };
  }, [sources]);
  const scopeOf = (index: number): MountScope<W> => {
    const { key, slice, closed } = sources[index]!;
    const reading = slice ? appAtomRegistry.get(slice) : null;
    const seen = reading ? previousOf(reading) : undefined;
    const empty = seen?.doc === null ? sources[index]!.graph.work?.safeParse({}) : null;
    const doc = seen?.doc ?? (empty?.success ? empty.data : undefined);
    return {
      workKey: key ?? undefined,
      closed,
      failure:
        key && key.route !== sources[index]!.graph.key
          ? "That Work belongs to another route"
          : reading?.state === "failed"
            ? reading.message
            : null,
      target: { kind: "host" },
      work:
        key && seen && doc !== undefined
          ? {
              handle: { key, revision: seen.revision ?? 0 },
              doc: doc as W,
            }
          : null,
    };
  };
  useEffect(() => {
    sources.forEach(({ held }, index) => held?.writer.observe(scopeOf(index)));
  }, [sources, readings]);
  return sources.map(({ key, graph, held }, index) => {
    const reading = readings?.[index];
    const seen = reading ? previousOf(reading) : undefined;
    const write = async (
      patches: RouteStatePatch[],
      expectedRevision = seen?.revision ?? 0,
      context: { press: string } = { press: crypto.randomUUID() },
    ) =>
      held
        ? writeRefusal(
            await held.writer.write(
              scopeOf(index),
              {
                kind: "apply",
                patches,
                expectedRevision,
                press: context.press,
              },
              writeRouteWork,
              graph.cells,
            ),
          )
        : refuse("not-ready", "Choose a Work first");
    return {
      doc: scopeOf(index).work?.doc ?? null,
      revision: seen?.revision ?? null,
      stale: reading?.state === "stale",
      conflict: held?.writer.conflict() ?? false,
      pending: held?.writer.pending() ?? [],
      write,
      retry: async (press: string) => {
        const request = held?.writer.pending().find((request) => request.press === press);
        if (!request) return refuse("not-ready", "That edit is no longer pending");
        return write(request.patches, scopeOf(index).work?.handle.revision, { press });
      },
      discard: (press: string) => held?.writer.discard(press),
      reload: () => {
        if (key) dirty({ ...key, kind: "work" });
      },
    };
  });
}
