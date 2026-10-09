/**
 * The instances route, declared once. Instances is where sessions come FROM, so it declares no
 * `needs`: it must render with nothing attached. Its Readings are the four SDK/broker subjects the
 * surface already subscribes (`useFleet()` = sessions + inventory, plus the doctor's
 * installed years and the per-year recents), and its one route-level action is the refresh that
 * reacquires them without touching Work — the lifecycle commands (start/open/restart/stop) are
 * staged-document verbs and stay in the cluster's sticky card.
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
import { INSTANCES_SEEDS } from "#/instances/seeds";

export type InstancesReading = "sessions" | "inventory" | "doctor" | "recents";
export type InstancesHandle = RouteHandle<InstancesDocument, InstancesReading, object, "refresh">;

const READINGS = {
  sessions: { kind: "sdk", read: "sessions" },
  inventory: { kind: "inventory" },
  doctor: { kind: "sdk", read: "doctor" },
  recents: { kind: "sdk", read: "recents" },
} as const satisfies Record<InstancesReading, ReadingRequest>;

export const instancesManifest = defineRoute({
  key: "instances",
  name: "Instances",
  docs: "Refresh the SDK census to inspect available sessions, installed years, diagnostics and recent documents before starting or recovering a session.",
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
      says: "reacquire the SDK census, installed years and recents without changing Work",
      needs: "host",
      actor: "any",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: ["sessions", "inventory", "doctor", "recents"],
      rereads: "sessions",
      ready: () => null,
      run: async () => {
        for (const request of Object.values(READINGS)) dirty(request);
      },
    },
  },
  seeds: INSTANCES_SEEDS,
});
