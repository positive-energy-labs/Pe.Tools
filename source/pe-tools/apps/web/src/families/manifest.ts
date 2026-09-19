/**
 * `/families`, declared once on the route kernel. The audit is the loaded-families matrix over an
 * authored scope, its cells open to proposals; capture files one spec member per picked family;
 * plan reads the page's member, or sends one draft per family generated from staged cells, and
 * apply sends the sheet's included hashes. Work holds the scope and keyed cells,
 * and the rows a person held back.
 */
import { z } from "zod";
import {
  familiesRouteState,
  ffPlanEntrySchema,
  type FamiliesRouteDocument,
} from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA, ffPlanRow } from "#/host/familyfoundry";
import { FAMILY_MODEL_SCHEMA } from "#/route/family/manifest";
import {
  admissionPlan,
  byPlan,
  entityRoute,
  workflow,
  type EntityPage,
  type EntityRouteDef,
  type PlanEntry,
} from "#/route";

import type { FamiliesDraft } from "./host";
import { FAMILIES_SEEDS } from "./seeds";
import { stagedDrafts } from "./staged";

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

/** The generated draft's `$schema`: this library, on the host actually serving the page. */
const stagedSchema = () =>
  typeof location === "undefined" ? FF_SPEC_SCHEMA : new URL(FF_SPEC_SCHEMA, location.origin).href;

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
        (work) => (work.executionOptions ? { executionOptions: work.executionOptions } : {}),
      ),
      // Held-back families are authored Work, by name; the sheet's rows are this plan's ids.
      excluded: (view) =>
        (view.page.sheet?.entries ?? []).flatMap((entry) =>
          Object.hasOwn(view.work.doc?.excluded ?? {}, entry.name) ? [entry.id] : [],
        ),
    },
    /**
     * The editable table's half. Plan takes staged cells only, generates one patch draft per family
     * from them, and plans each through `families.plan` over exactly that family's name, sending the
     * draft's bytes. Nothing is filed: the plan seals those bytes, and apply's run in the page's pod
     * keeps them as a supplied draft. Saving a spec to the pod is capture's job, never plan's.
     */
    staged: {
      cells: (ctx) => ctx.work.doc?.cells ?? {},
      plan: async (ctx) => {
        const doc = ctx.work.doc;
        if (!doc || ctx.work.revision === null) throw Error("author the route's Work first");
        if (!ctx.page.pod) throw Error("choose the pod the run is filed in");
        const bases = { work: { key: ctx.work.key, revision: ctx.work.revision } };
        const entries: PlanEntry[] = [];
        for (const draft of stagedDrafts(doc.cells, stagedSchema())) {
          const result = await workflow(
            "families.plan",
            {
              source: { pod: ctx.page.pod, path: draft.path, content: draft.content },
              // The draft selects one family by name, so the host plans that family alone and
              // never lays one family's types onto the rest of the scope.
              familyNames: [draft.familyName],
              ...(doc.executionOptions ? { executionOptions: doc.executionOptions } : {}),
            },
            ctx,
            bases,
          );
          for (const plan of [result.plan].flat())
            entries.push({ ...ffPlanRow(ffPlanEntrySchema.parse(plan)), plan: String(result.id) });
        }
        return { entries };
      },
      // Each draft's plan sealed its bytes and the staged cells it consumed; the host retires
      // those cells after proven native success, only where they are still unchanged.
      apply: async (ctx, included) => {
        for (const input of byPlan(included)) await workflow("families.apply", input, ctx);
      },
    },
    docs: "Audit loaded families over a scope, propose values in keyed cells and stage or deny each proposal, capture picked families into a pod as specs, then plan a saved spec or the staged cells as a draft (filed nowhere) and apply exactly the families it changes.",
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
