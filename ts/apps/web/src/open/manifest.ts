/**
 * The Open route, declared once (machine control plane, host ledger 2026-10-09 ruling 3). Open is
 * where Revits come FROM, so it declares no `needs`: it renders with nothing attached. Its
 * Readings are the host's one `Machine` (years, sessions, documents) and the SDK recents across
 * every installed year; its one route-level action is the refresh that reacquires both. Open holds
 * no authored Work (ADR 0016): a launch is one `instances.open` action, never a staged value. The
 * lifecycle verbs (start, open, hr, stop) stay with the launcher and the Running list. The internal
 * `instances` key and capability ids outlive the retired URL.
 */
import { z } from "zod";
import { instancesActions, type ReadingRequest } from "@pe/agent-contracts";

import { defineRoute } from "#/route/manifest";
import type { RouteHandle } from "#/route/handle";
import { dirty } from "#/readings";
import { OPEN_SEEDS } from "#/open/seeds";

export type OpenReading = "machine" | "recents";
export type OpenHandle = RouteHandle<object, OpenReading, object, "refresh">;

const READINGS = {
  machine: { kind: "machine" },
  recents: { kind: "sdk", read: "recents" },
} as const satisfies Record<OpenReading, ReadingRequest>;

export const openManifest = defineRoute({
  key: "instances",
  name: "Open",
  docs: "Start a Revit, open a model, and see which Revit holds it. Refresh reacquires the machine reading and the recent documents of every installed year.",
  readings: READINGS,
  runs: Object.keys(instancesActions) as (keyof typeof instancesActions)[],
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
