/**
 * `/families`, declared once on the route kernel. The audit is the loaded-families matrix over an
 * authored scope, its cells open to proposals; plan reads the page's member, or sends one draft per family generated from staged cells, and
 * apply sends the sheet's included hashes. Work holds the scope and keyed cells,
 * and the rows a person held back.
 */
import { z } from "zod";
import {
  familiesRouteState,
  ffPlanEntrySchema,
  workKey,
  type ActionReceipt,
  type FamiliesRouteDocument,
} from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA, ffPlanRow } from "#/host/familyfoundry";
import { FAMILY_MODEL_SCHEMA } from "#/family/manifest";
import {
  admissionPlan,
  byPlan,
  documentOf,
  entityRoute,
  workflow,
  type EntityPage,
  type HeldRow,
  type EntityRouteDef,
  type PlanEntry,
} from "#/route";

import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { applyOutcome, type PlanRun } from "./apply-outcome";
import {
  archivedFamiliesObservation,
  readFamiliesObservation,
  type FamiliesDraft,
  type FamiliesObservation,
} from "./host";
import { FAMILIES_SEEDS } from "./seeds";
import { podHost } from "#/route/pods";
import { stagedDrafts } from "./staged";
import { DEFAULT_FAMILIES_RULES } from "./pivot-rules";

export interface FamiliesPage {
  /** The next read's scope. Picker changes never issue a matrix read. */
  draft: FamiliesDraft;
  /** The exact document and scope last requested by the person. */
  reading: FamiliesObservation | null;
  readbackError: string | null;
  /** Pivot rule text; route-owned so Pea and direct URLs address the same view. */
  rules: string;
  /**
   * After start fresh: the fresh page offers to hold the old Work's exclusions back again, until
   * pressed, dismissed, or the next plan (journeys' ruling). ponytail: page memory, so a reload
   * drops the offer; the old Work stays aside and salvageable.
   */
  carryOver: boolean;
}

const familiesPageSchema = z.object({
  draft: z
    .object({
      placement: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]).default("AllLoaded"),
      categories: z.array(z.string()).default([]),
      families: z.array(z.string()).nullable().default(null),
    })
    .default({ placement: "AllLoaded", categories: [], families: null }),
  reading: z
    .object({
      document: z.object({ session: z.string(), openId: z.string() }),
      id: z.string(),
      work: z.custom<FamiliesObservation["work"]>(),
      capturedAt: z.string(),
      completedAt: z.string(),
      readback: z
        .object({
          sourceId: z.string(),
          verifiedFamilies: z.array(z.object({ name: z.string(), at: z.string() })),
        })
        .optional(),
      filter: z.object({
        categoryNames: z.array(z.string()),
        familyNames: z.array(z.string()),
        placementScope: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]),
      }),
      result: z.custom<FamiliesObservation["result"]>(),
    })
    .nullable()
    .default(null),
  readbackError: z.string().nullable().default(null),
  rules: z.string().default(DEFAULT_FAMILIES_RULES),
  carryOver: z.boolean().default(false),
});

export type FamiliesReadingKey = "receipts" | "inventory";

/**
 * The plan result's `excluded` ({ familyName, by }): the sheet says who held each family back, by
 * name. A name the plan did not plan fails loud rather than drawing a row nothing backs.
 */
const heldResult = z.array(z.object({ familyName: z.string(), by: z.enum(["person", "pea"]) }));
const heldOf = (result: Record<string, unknown>, entries: readonly PlanEntry[]): HeldRow[] =>
  heldResult.parse(result.excluded ?? []).map(({ familyName, by }) => {
    if (!entries.some((row) => row.id === familyName))
      throw Error(`the plan held back '${familyName}', which it did not plan`);
    return { name: familyName, by };
  });

/* ── The definition ────────────────────────────────────────────────────────── */

/** The generated draft's `$schema`: this library, on the host actually serving the page. */
const stagedSchema = () =>
  typeof location === "undefined" ? FF_SPEC_SCHEMA : new URL(FF_SPEC_SCHEMA, location.origin).href;

type FamiliesApplyCtx = Parameters<
  NonNullable<
    EntityRouteDef<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>["staged"]
  >["apply"]
>[0];

async function applyFamiliesPlans(
  ctx: FamiliesApplyCtx,
  included: readonly PlanEntry[],
  savedSpec: boolean,
) {
  const runs: PlanRun[] = [];
  let readbackId: string | null = null;
  let readbackError: string | null = null;
  for (const input of byPlan(included)) {
    const action = (await runSemanticAction(
      "families.apply",
      input,
      documentOf(ctx),
      savedSpec && ctx.work.revision !== null
        ? { work: { key: ctx.work.key, revision: ctx.work.revision } }
        : undefined,
    )) as ActionReceipt;
    runs.push({
      families: included.filter((row) => row.plan === input.plan).map((row) => row.name),
      action,
    });
    const result =
      action.state === "succeeded"
        ? (action.result as { readback?: { id?: string }; readbackError?: string })
        : null;
    if (result?.readback?.id) readbackId = result.readback.id;
    if (result?.readbackError) readbackError = result.readbackError;
  }
  if (readbackId) {
    try {
      const reading = await archivedFamiliesObservation(readbackId);
      const target = documentOf(ctx);
      if (
        reading.document.session !== target.session ||
        reading.document.openId !== target.openId ||
        workKey(reading.work) !== workKey(ctx.work.key)
      )
        throw Error("Readback belongs to another Families target");
      ctx.setPage({ reading, readbackError }, ["reading", "stage"]);
    } catch (error) {
      readbackError = `Families applied, but their saved readback could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
      ctx.setPage({ readbackError }, ["reading", "stage"]);
    }
  } else if (readbackError) ctx.setPage({ readbackError }, ["reading", "stage"]);
  return applyOutcome(runs, included.length);
}

export const familiesSpec: EntityRouteDef<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage> =
  {
    key: "families",
    name: "Families",
    entity: "families",
    target: "document",
    schema: [FF_SPEC_SCHEMA, FAMILY_MODEL_SCHEMA],
    apply: "families.apply",
    targetReady: (ctx) => {
      if (ctx.page.stage === "archived") return "Archived readings are inspection only";
      if (!stagedDrafts(ctx.work.doc?.cells ?? {}).length) return null;
      const read = ctx.page.reading;
      const target = documentOf(ctx);
      return read?.document.session === target.session &&
        read.document.openId === target.openId &&
        read.capturedAt === ctx.work.doc?.takenAt
        ? null
        : "read these families in this exact document before planning their edits";
    },
    // `families.plan` plans the page's member over the Work's scope; apply sends the included hashes.
    plan: {
      ...admissionPlan<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>(
        { plan: "families.plan", apply: "families.apply" },
        (plan) => ffPlanRow(ffPlanEntrySchema.parse(plan)),
        (work) => (work.executionOptions ? { executionOptions: work.executionOptions } : {}),
        heldOf,
      ),
      // Held-back families are authored Work, by name; the sheet's rows are this plan's ids.
      excluded: (view) =>
        (view.page.sheet?.entries ?? []).flatMap((entry) =>
          Object.hasOwn(view.work.doc?.excluded ?? {}, entry.name) ? [entry.id] : [],
        ),
      apply: async (ctx, included) => {
        await applyFamiliesPlans(ctx, included, true);
      },
    },
    /**
     * The editable table's half. Plan takes staged cells only, generates one patch draft per family
     * from them, and plans each through `families.plan` over exactly that family's name, sending the
     * draft's bytes. Nothing is filed: the plan seals those bytes, and apply's run in the page's pod
     * keeps them as a supplied draft. Plan never files: capture saves specs, and `save draft to pod`
     * saves a copy of the draft, both only when pressed.
     */
    staged: {
      cells: (ctx) => ctx.work.doc?.cells ?? {},
      plan: async (ctx) => {
        const doc = ctx.work.doc;
        if (!doc || ctx.work.revision === null) throw Error("author the route's Work first");
        const bases = { work: { key: ctx.work.key, revision: ctx.work.revision } };
        const entries: PlanEntry[] = [];
        const held: HeldRow[] = [];
        for (const draft of stagedDrafts(doc.cells, stagedSchema())) {
          const result = await workflow(
            "families.plan",
            {
              source: { path: draft.path, content: draft.content },
              // The draft selects one family by name, so the host plans that family alone and
              // never lays one family's types onto the rest of the scope.
              familyNames: [draft.familyName],
              ...(doc.executionOptions ? { executionOptions: doc.executionOptions } : {}),
            },
            ctx,
            bases,
          );
          const rows = [result.plan].flat().map((plan) => ({
            ...ffPlanRow(ffPlanEntrySchema.parse(plan)),
            plan: String(result.id),
          }));
          entries.push(...rows);
          held.push(...heldOf(result, rows));
        }
        return held.length ? { entries, held } : { entries };
      },
      // Each draft's plan sealed its bytes and the staged cells it consumed; the host retires
      // those cells after proven native success, only where they are still unchanged.
      // One action per plan; the verb's outcome is every family's receipt, summed (F-J3-3/4).
      apply: (ctx, included) => applyFamiliesPlans(ctx, included, false),
    },
    docs: "Read loaded families on request, stage reviewed values, then plan those cells as drafts or plan a saved Pod patch and apply the confirmed families.",
  };

const familiesRoute = entityRoute<
  FamiliesRouteDocument,
  FamiliesReadingKey,
  FamiliesPage,
  "read" | "save-draft" | "set-rules"
>(familiesSpec, {
  work: familiesRouteState,
  readings: {
    receipts: { kind: "receipts", target: { session: "", openId: "" } },
    inventory: { kind: "inventory" },
  } as never,
  page: familiesPageSchema as never,
  actions: {
    "set-rules": {
      label: "set table rules",
      says: "Set the Families pivot's narrowing rules without reading or changing Revit.",
      needs: "host",
      actor: "any",
      visible: false,
      input: z.object({ rules: z.string() }) as never,
      dirties: [],
      ready: () => null,
      run: async (ctx, input: { rules: string }) => {
        ctx.setPage({ rules: input.rules });
      },
    },
    read: {
      label: "read families",
      says: "Read the drafted families from this exact document; category and family picks alone do not read the matrix.",
      needs: "project",
      actor: "any",
      input: z.void() as never,
      dirties: [],
      waitSeconds: 240,
      stage: "audit",
      count: (ctx) => ctx.page.draft.families?.length || null,
      ready: (ctx) =>
        ((ctx.page as FamiliesPage & EntityPage).stage === "archived"
          ? "Archived readings are inspection only"
          : null) ??
        ctx.work.refusal ??
        (!ctx.page.draft.categories.length
          ? "choose a category first"
          : ctx.page.draft.families?.length === 0
            ? "choose at least one family"
            : null),
      run: async (ctx) => {
        const { categories, families, placement } = ctx.page.draft;
        const target = documentOf(ctx);
        const filter = {
          categoryNames: [...categories],
          familyNames: families ? [...families] : [],
          placementScope: placement,
        };
        const reading = await readFamiliesObservation(ctx.work.key, target, filter);
        // A plan confirmed over another scope no longer describes what apply would touch.
        (ctx.setPage as (next: Partial<EntityPage>) => void)({ confirming: false, sheet: null });
        await ctx.write([
          {
            // The person's scope is the staged rung; Pea's proposal waits beside it (F-J1-10).
            path: ["scope", "staged"],
            value: {
              value: filter,
            },
          },
          { path: ["takenAt"], value: reading.capturedAt },
        ]);
        // entityRoute adds stage to the page even though this action is declared on FamiliesPage.
        (
          ctx.setPage as (
            next: Partial<FamiliesPage>,
            guard: readonly (keyof (FamiliesPage & EntityPage))[],
          ) => void
        )({ reading, readbackError: null }, ["reading", "stage"]);
      },
    },
    "save-draft": {
      label: "save draft to pod",
      says: "Saves a copy of the staged draft into the chosen pod, one member per family, for the person to edit later. Optional: plan does not need it and still plans the staged cells' own bytes.",
      needs: "project",
      actor: "any",
      input: z.void() as never,
      // The pod list is the entity's Reading; saved members show there.
      dirties: ["pods"] as never,
      stage: "apply",
      count: (ctx) => stagedDrafts(ctx.work.doc?.cells ?? {}).length || null,
      ready: (ctx) =>
        (ctx.page as FamiliesPage & EntityPage).stage === "archived"
          ? "Archived readings are inspection only"
          : !stagedDrafts(ctx.work.doc?.cells ?? {}).length
            ? "nothing is staged to save"
            : (ctx.page as unknown as EntityPage).pod
              ? null
              : "choose the pod the draft is saved in",
      // ponytail: a create refuses an existing path, so a second save of the same family refuses in
      // the pod's words; overwrite (pod.member.save with the read sha) if people ask for re-saves.
      run: async (ctx) => {
        const { pod } = ctx.page as unknown as EntityPage;
        for (const draft of stagedDrafts(ctx.work.doc?.cells ?? {}, stagedSchema()))
          await podHost.write({ pod, path: draft.path }, draft.content);
      },
    },
  },
  seeds: FAMILIES_SEEDS as never,
});

export const manifest = {
  ...familiesRoute,
  stages: [...(familiesRoute.stages ?? []), { key: "archived", word: "Archived" }],
};
