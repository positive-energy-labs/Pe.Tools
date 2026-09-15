/**
 * The Families route, declared once. Work is the authored profile/scope document; the two seeds
 * are plain authored Work and an empty capture stream — no store, no host.
 */
import { z } from "zod";
import {
  familiesBasis,
  familiesIncluded,
  familiesPlanReadingSchema,
  familiesRouteState,
  familyCaptureSchema,
  type FamiliesRouteDocument,
  type Seed,
  type WorkKey,
} from "@pe/agent-contracts";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";

import {
  defineRoute,
  semanticActionFacts,
  semanticActionInput,
  type Ctx as RouteCtx,
} from "#/route";
import { previousOf } from "#/readings";

import type { FamiliesDraft } from "./host";
import { familyFlag } from "./plan";
import {
  actionResult,
  readFamilyCapture,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

type FamiliesStage = "scope" | "review";

export interface FamiliesPage {
  /** The Situation's first word: scoping the profile, or reviewing its plan. */
  stage: FamiliesStage;
  view: "matrix" | "plan";
  /** The scope being authored: what `scope` writes into Work when pressed. Page, not Work. */
  draft: FamiliesDraft;
}

export const familiesPageSchema = z.object({
  stage: z.enum(["scope", "review"]).default("scope"),
  view: z.enum(["matrix", "plan"]).default("matrix"),
  draft: z
    .object({
      placement: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]).default("AllLoaded"),
      categories: z.array(z.string()).default([]),
      families: z.array(z.string()).default([]),
    })
    .default({ placement: "AllLoaded", categories: [], families: [] }),
});

export type FamiliesReadingKey = "families" | "receipts" | "inventory";

type Ctx = RouteCtx<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>;

/* ── Pure projections ──────────────────────────────────────────────────────── */

/** The newest `families-plan` capture in the family-readings stream, with its capture id. */
export function latestPlanOf(rows: unknown) {
  if (!rows) return null;
  const row = familyCaptureSchema
    .array()
    .parse(rows)
    .find((capture) => capture.reading.kind === "families-plan");
  return row && row.reading.kind === "families-plan"
    ? { id: row.id, value: familiesPlanReadingSchema.parse(row.reading.value) }
    : null;
}

/** Why Apply is refused, or null. A saved plan is stale purely because its basis moved. */
export function applyRefusalOf(
  doc: FamiliesRouteDocument | null,
  saved: { value: { basis: string } } | null,
  plan: { entries: readonly { familyId: number }[] } | null,
  excludedIds: readonly number[],
): string | null {
  if (saved && doc && saved.value.basis !== familiesBasis(doc))
    return "The profile or scope changed after this plan. Plan again.";
  if (!plan) return "plan first";
  return plan.entries.some(
    (entry) => !excludedIds.includes(entry.familyId) && !familyFlag(entry as never),
  )
    ? null
    : "No included family has changes to apply.";
}

/** The plan that still describes the authored basis, with what it would include. */
const planOf = (ctx: Ctx) => {
  const latest = latestPlanOf(previousOf(ctx.readings.families));
  const doc = ctx.work.doc;
  const plan = doc && latest && latest.value.basis === familiesBasis(doc) ? latest.value : null;
  const excluded = doc?.excludedIds ?? [];
  const included = plan
    ? plan.entries.filter(
        (entry) => !excluded.includes(entry.familyId) && familyFlag(entry) === null,
      )
    : [];
  return { latest, plan, included };
};

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("An open project document is required");
  return ctx.target.ref;
};

const workOf = (ctx: Ctx) => {
  if (!ctx.work.doc || ctx.work.revision === null)
    throw Error("Current authored Families Work is required");
  return { key: ctx.work.key, revision: ctx.work.revision };
};

/**
 * A seed must leave the route in a state where its own action is runnable: both actions refuse
 * without a profile, so the seeded Work names one. The `families` Reading is the family-readings
 * CAPTURE stream (`host/demo-client.ts:99` parses it with `familyCaptureSchema.array()`), not the
 * authored snapshot rows it used to hold — those rows are not captures and threw on mount.
 */
const seededWork: FamiliesRouteDocument = familiesRouteState.schema.parse({
  profilePath: "C:\\Profiles\\review.ffprofile",
});
const emptyInventory = { sessions: [] } satisfies {
  sessions: readonly BridgeSessionListEntry[];
};

const seed = (
  title: string,
  stage: FamiliesStage,
  view: FamiliesPage["view"],
): Seed<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage> => ({
  title,
  work: seededWork,
  readings: { families: [], receipts: [], inventory: emptyInventory },
  page: { stage, view, draft: familiesPageSchema.parse({}).draft },
});

export const manifest = defineRoute({
  key: "families",
  name: "Families",
  needs: "project",
  work: familiesRouteState,
  readings: {
    families: (_page: FamiliesPage, work: WorkKey) => ({ kind: "family-readings", work }),
    receipts: { kind: "receipts", target: { session: "", openId: "" } },
    inventory: { kind: "inventory" },
  } as never,
  page: familiesPageSchema,
  stages: [
    { key: "scope", word: "Scoping" },
    { key: "review", word: "Reviewing" },
  ],
  actions: {
    scope: {
      label: "apply scope",
      says: "Write the drafted categories, families and placement as the audited scope.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["families"],
      stage: "scope",
      count: (ctx: Ctx) => ctx.page.draft.categories.length || null,
      ready: (ctx: Ctx) => (ctx.page.draft.categories.length ? null : "Pick a category first"),
      run: async (ctx: Ctx) => {
        const { categories, families, placement } = ctx.page.draft;
        await ctx.write([
          {
            path: ["scope"],
            value: {
              categoryNames: [...categories],
              familyNames: [...families],
              placementScope: placement,
            },
          },
        ]);
      },
    },
    plan: {
      label: "plan",
      says: "Read a native plan for the authored profile and scope.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["families"],
      requires: { work: true },
      count: (ctx: Ctx) => ctx.work.doc?.scope?.familyNames.length ?? null,
      ready: (ctx: Ctx) => (ctx.work.doc?.profilePath ? null : "Choose a profile"),
      run: async (ctx: Ctx) => {
        await ctx.external(async () => {
          await readFamilyCapture("families.plan", {}, workOf(ctx).key, targetOf(ctx));
        });
      },
    },
    apply: {
      label: "apply",
      ...semanticActionFacts("families.apply"),
      input: z.void(),
      dirties: ["families", "receipts"],
      requires: { work: true, readings: ["families"] },
      stage: "review",
      count: (ctx: Ctx) => planOf(ctx).included.length || null,
      ready: (ctx: Ctx) => {
        const doc = ctx.work.doc;
        if (!doc?.profilePath) return "Choose a profile";
        const { latest, plan } = planOf(ctx);
        return applyRefusalOf(doc, latest, plan, doc.excludedIds);
      },
      run: async (ctx: Ctx) => {
        const { latest, plan } = planOf(ctx);
        const doc = ctx.work.doc;
        if (!latest || !plan || !doc) throw Error("A current reviewed Families plan is required");
        await ctx.external(async () => {
          actionResult(
            await runSemanticAction(
              "families.apply",
              semanticActionInput("families.apply", {
                planId: latest.id,
                expectedPlanHashes: familiesIncluded(plan, doc.excludedIds),
              }),
              targetOf(ctx),
              { work: workOf(ctx) },
            ),
          );
        });
      },
    },
  } as never,
  seeds: {
    plan: seed("Families review — a profile is named, no plan read yet", "scope", "matrix"),
    apply: seed("Families review — a profile is named, the plan view is open", "review", "plan"),
  } as never,
});
