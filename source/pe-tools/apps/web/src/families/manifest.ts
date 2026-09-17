/**
 * `/families`, declared once on the route kernel. The audit is the loaded-families matrix over an
 * authored scope; capture files one spec member per picked family; apply confirms the page's
 * member over the scope and applies the sheet's included hashes. Work holds the scope and the
 * rows a person held back; the spec is the page's member and nothing else.
 */
import { z } from "zod";
import {
  familiesRouteState,
  ffPlanEntrySchema,
  type FamiliesRouteDocument,
} from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA, ffPlanRow } from "#/host/familyfoundry";
import { FAMILY_MODEL_SCHEMA } from "#/route/family/manifest";
import { admissionPlan, entityRoute, type EntityPage, type EntityRouteDef } from "#/route";

import type { FamiliesDraft } from "./host";
import { FAMILIES_SEEDS } from "./seeds";

export interface FamiliesPage {
  /** The scope being authored: what `scope` writes into Work when pressed. Page, not Work. */
  draft: FamiliesDraft;
}

export const familiesPageSchema = z.object({
  draft: z
    .object({
      placement: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]).default("AllLoaded"),
      categories: z.array(z.string()).default([]),
      families: z.array(z.string()).default([]),
    })
    .default({ placement: "AllLoaded", categories: [], families: [] }),
});

export type FamiliesReadingKey = "receipts" | "inventory";

/* ── The definition ────────────────────────────────────────────────────────── */

export const familiesSpec: EntityRouteDef<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage> =
  {
    key: "families",
    name: "Families",
    entity: "families",
    target: "selection",
    // A patch spec, or a captured family model (the engine converts a model by `$schema`).
    schema: [FF_SPEC_SCHEMA, FAMILY_MODEL_SCHEMA],
    capture: "families.capture",
    apply: "families.apply",
    captureInput: (ctx) => ({ familyIds: ctx.page.selection.map(Number) }),
    // `families.plan` plans the page's member over the Work's scope; apply sends the included hashes.
    plan: {
      ...admissionPlan<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>(
        { plan: "families.plan", apply: "families.apply" },
        (plan) => ffPlanRow(ffPlanEntrySchema.parse(plan)),
        (work) => ({
          excludedIds: work.excludedIds,
          ...(work.executionOptions ? { executionOptions: work.executionOptions } : {}),
        }),
      ),
      // Held-back rows are authored Work; the sheet toggles them there.
      excluded: (view) => (view.work.doc?.excludedIds ?? []).map(String),
    },
    docs: "Audit loaded families over a scope, capture picked families into a pod as specs, then plan a saved spec and apply exactly the families it changes.",
  };

export const manifest = entityRoute<
  FamiliesRouteDocument,
  FamiliesReadingKey,
  FamiliesPage,
  "scope"
>(familiesSpec, {
  work: familiesRouteState,
  readings: {
    receipts: { kind: "receipts", target: { session: "", openId: "" } },
    inventory: { kind: "inventory" },
  } as never,
  page: familiesPageSchema as never,
  actions: {
    scope: {
      label: "apply scope",
      says: "Write the drafted categories, families and placement as the audited scope.",
      needs: "project",
      actor: "any",
      input: z.void() as never,
      dirties: [],
      stage: "audit",
      count: (ctx) => ctx.page.draft.categories.length || null,
      ready: (ctx) => (ctx.page.draft.categories.length ? null : "Pick a category first"),
      run: async (ctx) => {
        const { categories, families, placement } = ctx.page.draft;
        // A plan confirmed over another scope no longer describes what apply would touch.
        (ctx.setPage as (next: Partial<EntityPage>) => void)({ confirming: false, sheet: null });
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
  },
  seeds: FAMILIES_SEEDS as never,
});
