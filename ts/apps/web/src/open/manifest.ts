/**
 * The Open route, declared once (machine control plane, host ledger 2026-10-09 ruling 3). Open is
 * where Revits come FROM, so it declares no `needs`: it renders with nothing attached. Its
 * Readings are the host's one `Machine` (years, sessions, documents) and the SDK recents across
 * every installed year; its one route-level action is the refresh that reacquires both without
 * touching Work. The lifecycle verbs (start, open, hr, stop) stay with the launcher and the
 * Running list. The internal `instances` key, Work and capability ids identify authored work and
 * outlive the retired URL.
 */
import { z } from "zod";
import {
  instancesRouteState,
  type InstancesDocument,
  type InstancesLaunch,
  type ReadingRequest,
} from "@pe/agent-contracts";

import { defineRoute } from "#/route/manifest";
import type { RouteHandle } from "#/route/use-route";
import { dirty } from "#/readings";
import { OPEN_SEEDS } from "#/open/seeds";

export type OpenReading = "machine" | "recents";
export type OpenHandle = RouteHandle<InstancesDocument, OpenReading, object, "refresh">;

const READINGS = {
  machine: { kind: "machine" },
  recents: { kind: "sdk", read: "recents" },
} as const satisfies Record<OpenReading, ReadingRequest>;

export const openManifest = defineRoute({
  key: "instances",
  name: "Open",
  docs: "Start a Revit, open a model, and see which Revit holds it. Refresh reacquires the machine reading and the recent documents of every installed year.",
  work: instancesRouteState,
  // ONE shared workspace, not a document (spec §7): the cluster, the chat plugin and
  // `pe_do route:instances.*` must all name this key; a Target-keyed one reads an empty document.
  workKey: { binding: "workspace", route: "instances", target: null, work: "instances" },
  // The launch Pea may propose sits at the Work's root.
  cells: [
    {
      segment: null,
      key: "launch",
      groupOf: () => ["launch"],
      noun: "Revit sessions",
      show: (value) => {
        const launch = value as InstancesLaunch;
        return launch.kind === "open" ? `open ${launch.document}` : `start ${launch.year}`;
      },
    },
  ],
  readings: READINGS,
  actions: {
    refresh: {
      label: "refresh",
      says: "reacquire the machine reading and the recents without changing Work",
      needs: "host",
      actor: "any",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: ["machine", "recents"],
      rereads: "machine",
      ready: () => null,
      run: async () => {
        for (const request of Object.values(READINGS)) dirty(request);
      },
    },
  },
  seeds: OPEN_SEEDS,
});
