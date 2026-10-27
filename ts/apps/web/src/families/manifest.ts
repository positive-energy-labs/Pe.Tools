import { confirmedPlan } from "#/route/workflow";
/**
 * `/families`, declared once on the route kernel. The audit is the loaded-families matrix over an
 * authored scope and shared edits. The host owns draft composition, planning, Apply and readback;
 * an optional Preview opens the host's sealed plan. Work holds the scope and keyed cells.
 */
import { z } from "zod";
import {
  routeAddress,
  familiesReadProgressSchema,
  ffPlanEntrySchema,
  type AppliedFilter,
  type FamiliesRouteDocument,
  type PodDraftSource,
  type RoutePage,
} from "@pe/agent-contracts";
import { filterWords } from "./scope-band";

import { FF_SPEC_SCHEMA, ffPlanRow } from "#/host/familyfoundry";
import { FAMILY_MODEL_SCHEMA } from "#/family/manifest";
import {
  HISTORY,
  admissionPlan,
  documentOf,
  entityRoute,
  refuse,
  type EntityPage,
  type HeldRow,
  type EntityRouteDef,
  type PlanEntry,
} from "#/route";

import { actionResult } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { applyOutcome, applyTally, applyResults } from "./apply-outcome";
import { plural } from "#/components/work/band";
import {
  cancelFamiliesObservation,
  readFamiliesObservation,
  type FamiliesDraft,
  type FamiliesObservation,
} from "./host";
import { FAMILIES_SEEDS } from "./seeds";
import type { Inspectable } from "#/route/inspect";
import { familiesGroupOf, editedFamilies } from "./staged";

/**
 * The contract's fields (`routeAddress("families")`: stage, the opened spec, the pivot's table view
 * and History's `past` read) and the Page-only rest: a scope draft and a reading, which a link
 * cannot reopen (the Work's retained reading does).
 */
export interface FamiliesPage extends Omit<RoutePage<"families">, keyof EntityPage> {
  /** The next read's scope. Picker changes never issue a matrix read. */
  draft: FamiliesDraft;
  /** The exact document and scope last requested by the person. */
  reading: FamiliesObservation | null;
  /**
   * After start fresh: the fresh page offers to hold the old Work's exclusions back again, until
   * pressed, dismissed, or the next plan (journeys' ruling). ponytail: page memory, so a reload
   * drops the offer; the old Work stays aside and salvageable.
   */
  carryOver: boolean;
}

const familiesPageSchema = routeAddress("families").schema.extend({
  // A newly bound document drafts its placed families (ruling 44): the cheaper, relevant read.
  draft: z
    .object({
      placement: z.enum(["AllLoaded", "PlacedOnly", "UnplacedOnly"]).default("PlacedOnly"),
      categories: z.array(z.string()).default([]),
      families: z.array(z.string()).nullable().default(null),
    })
    .default({ placement: "PlacedOnly", categories: [], families: null }),
  reading: z
    .object({
      document: z.object({ session: z.string(), openId: z.string() }),
      id: z.string(),
      work: z.custom<FamiliesObservation["work"]>(),
      capturedAt: z.string(),
      completedAt: z.string(),
      progress: familiesReadProgressSchema.optional(),
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
  carryOver: z.boolean().default(false),
});

export type FamiliesReadingKey = "receipts" | "inventory" | "matrix";

/**
 * The plan result's `excluded` ({ familyName, by }): the sheet says who held each family back, by
 * name. A name the plan did not plan fails loud rather than drawing a row nothing backs.
 */
const heldResult = z.array(
  z.object({ familyName: z.string(), by: z.enum(["human", "pea", "unknown"]) }),
);
const heldOf = (result: Record<string, unknown>, entries: readonly PlanEntry[]): HeldRow[] =>
  heldResult.parse(result.excluded ?? []).map(({ familyName, by }) => {
    if (!entries.some((row) => row.id === familyName))
      throw Error(`the plan held back '${familyName}', which it did not plan`);
    return { name: familyName, by };
  });

/* ── The definition ────────────────────────────────────────────────────────── */

type FamiliesApplyCtx = Parameters<
  NonNullable<
    EntityRouteDef<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>["edit"]
  >["apply"]
>[0];

async function applyFamiliesPlans(ctx: FamiliesApplyCtx, included: readonly PlanEntry[]) {
  const action = await ctx.commands["families.apply"](confirmedPlan(included));
  if (action.state === "succeeded") noteReadback(ctx, action.result);
  const tally = applyTally(action);
  if (tally.families)
    ctx.note(
      [
        `apply ${plural(tally.families, "family")}`,
        `${tally.converged} converged`,
        tally.residue ? `${tally.residue} residue` : "",
        tally.failed ? `${tally.failed} failed` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      tally.artifact ?? "no artifacts on disk",
      tally.failed > 0,
      tally.artifact ? { kind: "artifact", id: tally.artifact } : undefined,
    );
  return applyOutcome(
    action,
    included.map((row) => row.name),
  );
}

function noteReadback(ctx: FamiliesApplyCtx, result: unknown) {
  for (const error of new Set(
    applyResults(result).flatMap((output) => (output.readbackError ? [output.readbackError] : [])),
  ))
    ctx.note("readback unavailable", error, true);
}

export const ARTIFACT: Inspectable = {
  label: (id) => id.split(/[\\/]/).at(-1) ?? id,
  open: { kind: "shell", path: (id) => id },
};

export const familiesSpec: EntityRouteDef<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage> =
  {
    key: "families",
    name: "Families",
    entity: "families",
    schema: [FF_SPEC_SCHEMA, FAMILY_MODEL_SCHEMA],
    apply: "families.apply",
    applies: ["matrix"],
    read: "explicit",
    // Capture files every family the reading on screen holds, one member each.
    capture: "families.capture",
    captureInput: (ctx) => {
      const ids = ctx.page.reading?.result.families.map((family) => family.familyId) ?? [];
      return ids.length ? { familyIds: ids } : "read families first";
    },
    targetReady: (ctx) => {
      if (ctx.page.reading?.progress && ctx.page.reading.progress.state !== "complete")
        return "Complete this Families read before planning edits";
      if (ctx.work.doc?.patch.edit && editedFamilies(ctx.work.doc.cells).length)
        return "Stage either a native Family Foundry patch or per-type cells, not both";
      if (ctx.work.doc?.patch.edit && !ctx.work.doc.scope.edit)
        return "stage a Families scope before planning the native patch";
      if (ctx.work.doc?.patch.edit) return null;
      if (!editedFamilies(ctx.work.doc?.cells ?? {}).length) return null;
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
        heldOf,
      ),
      // Held-back families are authored Work, by name; the sheet's rows are this plan's ids.
      excluded: (view) =>
        (view.page.sheet?.entries ?? []).flatMap((entry) =>
          Object.hasOwn(view.work.doc?.excluded ?? {}, entry.name) ? [entry.id] : [],
        ),
      apply: async (ctx, included) => {
        await applyFamiliesPlans(ctx, included);
      },
      // The one two-press apply (ruling 52): many families, rows a person may hold back.
    },
    /** The host derives every family draft from the rendered Work revision. */
    edit: {
      direct: async (ctx) => {
        const result = actionResult(await ctx.commands["families.apply"]({ include: "all" }));
        noteReadback(ctx, result);
      },
      cells: (ctx) => ({
        ...ctx.work.doc?.cells,
        ...(ctx.work.doc?.patch.edit ? { patch: ctx.work.doc.patch } : {}),
      }),
      plan: async (ctx) => {
        const result = actionResult(await ctx.commands["families.plan"]({})) as Record<
          string,
          unknown
        >;
        const entries = [result.plan].flat().map((plan) => ({
          ...ffPlanRow(ffPlanEntrySchema.parse(plan)),
          plan: String(result.id),
        }));
        const held = heldOf(result, entries);
        return held.length ? { entries, held } : { entries };
      },
      apply: (ctx, included) => applyFamiliesPlans(ctx, included),
    },
    docs: "Read loaded families on request, stage reviewed per-type values or a native Family Foundry patch, then plan those exact bytes or a saved Pod member and apply the confirmed families.",
  };

export const manifest = entityRoute<
  FamiliesRouteDocument,
  FamiliesReadingKey,
  FamiliesPage,
  "read" | "save-draft"
>(familiesSpec, {
  cells: [
    // The audited scope is a root cell Pea proposes (F-J1-10): its own group, beside the cells.
    {
      segment: null,
      key: "scope",
      groupOf: () => ["scope"],
      show: (value) => filterWords(value as AppliedFilter),
      commit: "plan",
    },
    {
      segment: null,
      key: "patch",
      groupOf: () => ["native FF patch"],
      // Exact bytes are reviewed in Families.
      show: (value) => {
        const source = value as PodDraftSource;
        try {
          const patch = JSON.parse(source.content);
          const names = patch?.select?.names;
          const parameters = patch?.patch?.parameters;
          if (
            Array.isArray(names) &&
            parameters &&
            typeof parameters === "object" &&
            !Array.isArray(parameters)
          )
            return `${Object.keys(parameters).join(", ")} · ${names.length} named families`;
        } catch {
          // Invalid source is still reviewable; the route owns validation.
        }
        return source.path;
      },
      commit: "plan",
    },
    {
      segment: "cells",
      groupOf: familiesGroupOf,
      nouns: ["parameter", "family"],
      show: (value) =>
        String(
          typeof value === "object" && value !== null && "value" in value ? value.value : value,
        ),
      commit: "plan",
    },
  ],
  // An apply's artifact bundle, on disk: opened in the host's default app, never copied.
  inspectables: { artifact: ARTIFACT },
  readings: {
    receipts: (_page: FamiliesPage, work: import("@pe/agent-contracts").WorkKey) => ({
      kind: "receipts",
      work,
    }),
    inventory: { kind: "inventory" },
    // The matrix read on screen, as an envelope: its taken-at, change mark and body id (ruling 3).
    matrix: (page: FamiliesPage) =>
      page.reading
        ? {
            kind: "families-matrix",
            target: { session: "", openId: "" },
            filter: page.reading.filter,
          }
        : null,
  } as never,
  page: familiesPageSchema as never,
  address: "families",
  actions: {
    read: {
      label: "read families",
      says: "Read the drafted families from this exact document; category and family picks alone do not read the matrix.",
      needs: "project",
      input: z.void() as never,
      dirties: ["matrix"],
      rereads: "matrix",
      waitSeconds: 1800,
      stage: "audit",
      count: (ctx) => ctx.page.draft.families?.length || null,
      ready: (ctx) =>
        ((ctx.page as FamiliesPage & EntityPage).stage === "history" ? HISTORY : null) ??
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
        const readId = crypto.randomUUID();
        const now = new Date().toISOString();
        const starting: FamiliesObservation = {
          id: `pending-${readId}`,
          work: ctx.work.key,
          document: target,
          filter,
          capturedAt: now,
          completedAt: now,
          progress: {
            runId: readId,
            state: "reading",
            phase: "preparing",
            completed: 0,
            total: 0,
            workers: 1,
          },
          result: {
            families: [],
            issues: [],
            page: { totalCount: 0, returnedCount: 0, isTruncated: false },
          },
        };
        const stage = (ctx.page as FamiliesPage & EntityPage).stage;
        const ownsRun = () => {
          if (!ctx.currentPage) return true;
          const current = ctx.currentPage() as (FamiliesPage & EntityPage) | null;
          return current?.reading?.progress?.runId === readId && current.stage === stage;
        };
        ctx.setPage({ reading: starting });
        ctx.cancelWith?.(() => cancelFamiliesObservation(target, readId));
        let reading: FamiliesObservation;
        try {
          reading = await readFamiliesObservation(
            ctx.work.key,
            target,
            filter,
            readId,
            ctx.work.revision ?? 0,
          );
        } catch (cause) {
          if (ownsRun()) {
            const current = ctx.currentPage?.()?.reading ?? starting;
            ctx.setPage({
              reading: {
                ...current,
                progress: {
                  ...(current.progress ?? starting.progress!),
                  state: "failed",
                  message: cause instanceof Error ? cause.message : String(cause),
                },
              },
            });
          }
          throw cause;
        }
        if (!ownsRun()) return;
        // Resource progress intentionally moves reading; the run id and stage guard its final result.
        (
          ctx.setPage as (
            next: Partial<FamiliesPage>,
            guard: readonly (keyof (FamiliesPage & EntityPage))[],
          ) => void
        )({ reading }, ["stage"]);
        if (reading.progress && reading.progress.state !== "complete")
          return refuse(
            "partial",
            reading.progress.message ??
              `${reading.progress.state} after ${reading.progress.completed} of ${reading.progress.total} families`,
          );
        // A plan confirmed over another scope no longer describes what apply would touch.
        (ctx.setPage as (next: Partial<EntityPage>) => void)({ confirming: false, sheet: null });
        await ctx.write(
          [
            {
              // The person's scope is the edit rung; Pea's suggestion waits beside it (F-J1-10).
              path: ["scope", "edit"],
              value: {
                value: filter,
              },
            },
          ],
          reading.envelope?.revision ?? ctx.work.revision ?? 0,
        );
        const page = reading.result.page;
        if (page?.isTruncated)
          ctx.note(
            "incomplete read",
            `${page.returnedCount} of ${page.totalCount} families returned`,
            true,
          );
        for (const issue of reading.result.issues)
          ctx.note("read issue", `${issue.familyName ?? issue.code}: ${issue.message}`, true);
      },
    },
    "save-draft": {
      label: "save draft to pod",
      says: "Saves a copy of the edit draft into the chosen pod, one member per family, for the person to edit later. Optional: plan does not need it and still plans the edit cells' own bytes.",
      needs: "project",
      input: z.void() as never,
      // The pod list is the entity's Reading; saved members show there.
      dirties: ["pods"] as never,
      stage: "apply",
      count: (ctx) => editedFamilies(ctx.work.doc?.cells ?? {}).length || null,
      ready: (ctx) =>
        (ctx.page as FamiliesPage & EntityPage).stage === "history"
          ? HISTORY
          : !editedFamilies(ctx.work.doc?.cells ?? {}).length
            ? "nothing is edit to save"
            : (ctx.page as unknown as EntityPage).pod
              ? null
              : "choose the pod the draft is saved in",
      // ponytail: a create refuses an existing path, so a second save of the same family refuses in
      // the pod's words; overwrite (pod.member.save with the read sha) if people ask for re-saves.
      run: async (ctx) => {
        const { pod } = ctx.page as unknown as EntityPage;
        actionResult(await ctx.commands["families.save-draft"]({ pod }));
      },
    },
  },
  seeds: FAMILIES_SEEDS as never,
});
