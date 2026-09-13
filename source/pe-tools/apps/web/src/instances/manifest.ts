/**
 * The instances route, declared once. Instances is where sessions come FROM, so it declares no
 * `needs`: it must render with nothing attached. Its Readings are the four SDK/broker subjects the
 * surface already subscribes (`useFleet({all:true})` = sessions + inventory, plus the doctor's
 * installed years and the per-year recents), and its one route-level action is the refresh that
 * reacquires them without touching Work — the lifecycle commands (start/open/restart/stop) are
 * staged-document verbs and stay in the cluster's sticky card.
 */
import { z } from "zod";
import type { ReadingRequest, WorkKey } from "@pe/agent-contracts";

import { defineRoute } from "#/route";
import { dirty } from "#/readings";
import { INSTANCES_SEEDS } from "#/instances/seeds";

export type InstancesReading = "sessions" | "inventory" | "doctor" | "recents";

/**
 * Instances Work is ONE shared workspace, not a document (spec §7). Declared here because the
 * cluster, the chat plugin and `pe_do route:instances.*` must all name the same key; a plugin
 * that invented a Target-keyed WorkKey read an empty document while pea wrote the workspace.
 */
export const INSTANCES_WORK: WorkKey = { route: "instances", target: null, work: "instances" };

const READINGS = {
  sessions: { kind: "sdk", read: "sessions", all: true },
  inventory: { kind: "inventory" },
  doctor: { kind: "sdk", read: "doctor" },
  recents: { kind: "sdk", read: "recents" },
} as const satisfies Record<InstancesReading, ReadingRequest>;

export const instancesManifest = defineRoute({
  key: "instances",
  name: "Instances",
  readings: READINGS,
  actions: {
    refresh: {
      label: "refresh",
      says: "reacquire the SDK census, installed years and recents without changing Work",
      needs: "host",
      actor: "any",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: ["sessions", "inventory", "doctor", "recents"],
      ready: () => null,
      run: async () => {
        for (const request of Object.values(READINGS)) dirty(request);
      },
    },
  },
  seeds: INSTANCES_SEEDS,
});
