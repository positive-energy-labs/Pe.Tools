import { legacyLiveVerbs, unavailableLegacyVerbs } from "./legacy-environment-bridge";
import type {
  ResolvedRead,
  ResolvedGeometryRead,
} from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { AcceptanceToken } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { type SettingsOwner } from "./settings";
import { workKey, type RouteGraph } from "@pe/agent-contracts";

import { createReadingGraph } from "./readings";

import { createRouteTimeline } from "./timeline";
import {type MountAdapters} from "./mount-contracts";
import type { MountScope } from "./work-scope";
import type { MountPage } from "./mount-page-owner";
/** Owns graph reading acquisition, dependency bases and reading-scope refresh. */
export function createMountReadings<P, W>(
  graph: RouteGraph<P, W>,
  adapters: MountAdapters<P, W>,
  page: MountPage<P, W>,
  settings: SettingsOwner,
  scope: () => MountScope<W>,
  timeline: ReturnType<typeof createRouteTimeline>,
) {
  const environment = () => {
    if (!adapters.environment) throw Error("Admitted environment unavailable");
    return adapters.environment.environment;
  };
  const readScope = () => ({
    target: scope().target,
    workKey: scope().workKey ?? scope().work?.handle.key ?? null,
    workRevision: scope().work?.handle.revision ?? null,
    work: scope().work?.doc ?? null,
    page: page.view.read().page,
    settings: settings.read().values,
  });
  // Page is a built-in graph input, not a host reading or a second writable Page.
  const needsPage =
    !graph.readings.page && Object.values(graph.readings).some((r) => r.deps?.includes("page"));
  const readings = createReadingGraph(
    {
      readings: {
        ...Object.fromEntries(
          Object.entries(graph.readings).map(([id, reading]) => [id, { ...reading, source: id }]),
        ),
        ...(needsPage
          ? {
              page: {
                kind: "derive" as const,
                source: "@shell/page",
                retire: "page" as const,
                args: (p: Readonly<P>) => p,
              },
            }
          : {}),
      },
    },
    {
      sources: {
        ...Object.fromEntries(
          Object.entries(graph.readings).map(([id, reading]) => [
            id,
            adapters.readingSources?.[id] ?? adapters.sources[reading.source]!,
          ]),
        ),
        ...(needsPage
          ? {
              "@shell/page": {
                kind: "derive" as const,
                derive: (ctx: { page: unknown }) => ctx.page,
              },
            }
          : {}),
      },
      scope: readScope(),
      log: (entry) => {
        adapters.logReading?.(entry);
        if (entry.kind === "feed")
          timeline.append({
            kind: "feed",
            at: Date.now(),
            verb: entry.reading,
            subject: entry.value,
            basis: { workKey: entry.attempt.workKey ? workKey(entry.attempt.workKey) : null },
          });
      },
    },
  );
  const basisFor = (ids: readonly string[]) =>
    Object.fromEntries(
      ids.map((id) => {
        const state = readings.get(id);
        return [id, { version: state.version, current: state.current, basis: state.basis }];
      }),
    );
  const basis = () =>
    Object.fromEntries(
      Object.keys(graph.readings).map((id) => {
        const state = readings.get(id);
        return [id, { version: state.version, current: state.current, basis: state.basis }];
      }),
    );
  return {
    ...readings,
    legacyReads: (adapters.environment
      ? unavailableLegacyVerbs
      : (adapters.legacyEnvironment ?? legacyLiveVerbs)
    ).reads,
    acquire: <T>(request: ResolvedRead<T>, token: AcceptanceToken) =>
      environment().reads.acquire(request, token),
    acquireGeometry: <T>(request: ResolvedGeometryRead<T>, token: AcceptanceToken) =>
      environment().geometry.acquire(request, token),
    subscribeResolved: <T>(
      request: ResolvedRead<T>,
      token: AcceptanceToken,
      deliver: (value: ReadingSnapshot<T>) => void,
    ) => environment().readings.subscribe(request, token, deliver),
    basis,
    basisFor,
    states: () =>
      Object.fromEntries(Object.keys(graph.readings).map((id) => [id, readings.get(id)])),
    syncScope: () => readings.update(readScope()),
  };
}
export type MountReadings<P, W> = ReturnType<typeof createMountReadings<P, W>>;
