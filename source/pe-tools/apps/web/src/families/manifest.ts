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
  type ActionReceipt,
  type FamiliesRouteDocument,
} from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA, ffPlanRow } from "#/host/familyfoundry";
import { FAMILY_MODEL_SCHEMA } from "#/route/family/manifest";
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
import type { FamiliesDraft } from "./host";
import { FAMILIES_SEEDS } from "./seeds";
import { podHost } from "#/route/pods";
import { stagedDrafts } from "./staged";

export interface FamiliesPage {
  /** The scope being authored: what `scope` writes into Work when pressed. Page, not Work. */
  draft: FamiliesDraft;
  /**
   * Each loaded family's element id by name, as the current matrix reading resolves it: a display
   * fact of that reading, never a key. Capture's contract takes ids, so it resolves the picks here
   * at the press. ponytail: a mirror of the matrix; drop it when capture takes names.
   */
  loaded: Record<string, number>;
  /**
   * After start fresh: the fresh page offers to hold the old Work's exclusions back again, until
   * pressed, dismissed, or the next plan (journeys' ruling). ponytail: page memory, so a reload
   * drops the offer; the old Work stays aside and salvageable.
   */
  carryOver: boolean;
}

export const familiesPageSchema = z.object({
  draft: z
    .object({
      placement: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]).default("AllLoaded"),
      categories: z.array(z.string()).default([]),
      families: z.array(z.string()).default([]),
    })
    .default({ placement: "AllLoaded", categories: [], families: [] }),
  loaded: z.record(z.string(), z.number()).default({}),
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
    // The picks are names; capture's contract takes ids, resolved against the current reading.
    captureInput: (ctx) => {
      const gone = ctx.page.selection.filter((name) => !Object.hasOwn(ctx.page.loaded, name));
      return gone.length
        ? `${gone.map((name) => `'${name}'`).join(", ")} ${gone.length === 1 ? "is" : "are"} no longer loaded; pick again`
        : { familyIds: ctx.page.selection.map((name) => ctx.page.loaded[name]!) };
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
        if (!ctx.page.pod) throw Error("choose the pod the run is filed in");
        const bases = { work: { key: ctx.work.key, revision: ctx.work.revision } };
        const entries: PlanEntry[] = [];
        const held: HeldRow[] = [];
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
      apply: async (ctx, included) => {
        const runs: PlanRun[] = [];
        for (const input of byPlan(included))
          runs.push({
            families: included.filter((row) => row.plan === input.plan).map((row) => row.name),
            action: (await runSemanticAction(
              "families.apply",
              input,
              documentOf(ctx),
            )) as ActionReceipt,
          });
        return applyOutcome(runs, included.length);
      },
    },
    docs: "Audit loaded families over a scope, propose values in keyed cells and stage or deny each proposal, capture picked families into a pod as specs, then plan a saved spec or the staged cells as a draft (filed nowhere) and apply exactly the families it changes.",
  };

export const manifest = entityRoute<
  FamiliesRouteDocument,
  FamiliesReadingKey,
  FamiliesPage,
  "scope" | "save-draft"
>(familiesSpec, {
  work: familiesRouteState,
  readings: {
    receipts: { kind: "receipts", target: { session: "", openId: "" } },
    inventory: { kind: "inventory" },
  } as never,
  page: familiesPageSchema as never,
  // The pod is the person's, on Work (F-B-5b): chosen once, it survives a reload and plans the draft.
  workPage: ["pod"] as never,
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
      // Unreadable Work takes no scope: its refusal (and start fresh) is the only instruction.
      ready: (ctx) =>
        ctx.work.refusal ?? (ctx.page.draft.categories.length ? null : "Pick a category first"),
      run: async (ctx) => {
        const { categories, families, placement } = ctx.page.draft;
        // A plan confirmed over another scope no longer describes what apply would touch.
        (ctx.setPage as (next: Partial<EntityPage>) => void)({ confirming: false, sheet: null });
        await ctx.write([
          {
            // The person's scope is the staged rung; Pea's proposal waits beside it (F-J1-10).
            path: ["scope", "staged"],
            value: {
              value: {
                categoryNames: [...categories],
                familyNames: [...families],
                placementScope: placement,
              },
            },
          },
        ]);
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
      stage: "audit",
      count: (ctx) => stagedDrafts(ctx.work.doc?.cells ?? {}).length || null,
      ready: (ctx) =>
        !stagedDrafts(ctx.work.doc?.cells ?? {}).length
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
