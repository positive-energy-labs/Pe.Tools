/**
 * The Families route, declared once. Work is the authored profile/scope document; the two seeds
 * are plain authored Work and an empty capture stream — no store, no host.
 */
import { z } from "zod";
import { familiesRouteState, type FamiliesRouteDocument, type Seed } from "@pe/agent-contracts";

import { defineRoute, type Ctx as RouteCtx } from "#/route";

export interface FamiliesPage {
  view: "matrix" | "plan";
  excluded: readonly number[];
}

export const familiesPageSchema = z.object({
  view: z.enum(["matrix", "plan"]).default("matrix"),
  excluded: z.array(z.number()).default([]),
});

export type FamiliesReadingKey = "families" | "receipts" | "inventory";

type Ctx = RouteCtx<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>;

/**
 * A seed must leave the route in a state where its own action is runnable: both actions refuse
 * without a profile, so the seeded Work names one. The `families` Reading is the family-readings
 * CAPTURE stream (`host/demo-client.ts:99` parses it with `familyCaptureSchema.array()`), not the
 * authored snapshot rows it used to hold — those rows are not captures and threw on mount.
 */
const seededWork: FamiliesRouteDocument = familiesRouteState.schema.parse({
  profilePath: "C:\\Profiles\\review.ffprofile",
});

const seed = (
  title: string,
  view: FamiliesPage["view"],
): Seed<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage> => ({
  title,
  work: seededWork,
  readings: { families: [], receipts: [], inventory: [] },
  page: { view, excluded: [] },
});

export const manifest = defineRoute({
  key: "families",
  name: "Families",
  needs: "project",
  work: familiesRouteState,
  readings: {
    families: { kind: "family-readings", work: { route: "families", target: null } },
    receipts: { kind: "receipts" },
    inventory: { kind: "inventory" },
  } as never,
  page: familiesPageSchema,
  actions: {
    plan: {
      label: "read plan",
      says: "Read a native plan for the authored profile and scope.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["families"],
      ready: (ctx: Ctx) => (ctx.work.doc.profilePath ? null : "Choose a profile"),
      run: async (ctx: Ctx) => {
        await ctx.call("families.plan", {});
      },
    },
    apply: {
      label: "apply plan",
      says: "Apply the included plan entries to the loaded families.",
      needs: "project",
      actor: "human",
      input: z.void(),
      dirties: ["families", "receipts"],
      ready: (ctx: Ctx) => (ctx.work.doc.profilePath ? null : "Choose a profile"),
      run: async (ctx: Ctx) => {
        await ctx.call("families.apply", {});
      },
    },
  } as never,
  seeds: {
    plan: seed("Families review — a profile is named, no plan read yet", "matrix"),
    apply: seed("Families review — a profile is named, the plan view is open", "plan"),
  } as never,
});
