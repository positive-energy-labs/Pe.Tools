/**
 * `/families`, declared once on the route kernel. The audit is the loaded-families matrix over an
 * authored scope; capture files one spec member per picked family; apply plans the saved spec over
 * the scope and confirms on the sheet. Work holds what the host checks at apply: the spec, the
 * scope, and the rows a person held back.
 */
import { z } from "zod";
import {
  canonicalRouteInput,
  familiesBasis,
  familiesPlanReadingSchema,
  familiesRouteState,
  familyCaptureSchema,
  type FamiliesRouteDocument,
  type WorkKey,
} from "@pe/agent-contracts";

import { FF_SPEC_SCHEMA, warningLine } from "#/host/familyfoundry";
import { previousOf } from "#/readings";
import {
  entityRoute,
  semanticActionInput,
  type Ctx as RouteCtx,
  type EntityPage,
  type EntityReading,
  type EntityRouteDef,
  type EntityView,
  type PlanSheet,
} from "#/route";

import type { FamiliesDraft } from "./host";
import { familyFlag, provenanceSummary } from "./plan";
import { FAMILIES_SEEDS } from "./seeds";
import {
  actionResult,
  readFamilyCapture,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

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

export type FamiliesReadingKey = "families" | "receipts" | "inventory";

type Ctx = RouteCtx<
  FamiliesRouteDocument,
  FamiliesReadingKey | EntityReading,
  FamiliesPage & EntityPage
>;
type View = EntityView<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>;

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

const sameMember = (a: { pod: string; path: string } | null | undefined, page: EntityPage) =>
  a?.pod === page.pod && a.path === page.path;

/**
 * The plan that still describes the authored basis for the page's member, as sheet rows. A plan
 * is stale purely because its basis moved; a stale plan draws no sheet.
 */
export function familiesPlanOf(view: View) {
  const doc = view.work.doc;
  const latest = latestPlanOf(previousOf(view.readings.families));
  return doc &&
    latest &&
    latest.value.basis === familiesBasis(doc) &&
    sameMember(doc.spec, view.page)
    ? latest
    : null;
}

export const familiesSheetOf = (view: View): PlanSheet | null => {
  const latest = familiesPlanOf(view);
  return latest
    ? {
        id: latest.id,
        entries: latest.value.entries.map((entry) => ({
          id: String(entry.familyId),
          name: entry.familyName,
          planHash: entry.planHash,
          actions: entry.changes.length + entry.runEffects.length,
          detail: provenanceSummary(entry),
          flag: familyFlag(entry),
          warnings: entry.warnings.map((warning) => `${warning.code} · ${warningLine(warning)}`),
        })),
      }
    : null;
};

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("An open project document is required");
  return ctx.target.ref;
};

/* ── The definition ────────────────────────────────────────────────────────── */

export const familiesSpec: EntityRouteDef<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage> =
  {
    key: "families",
    name: "Families",
    entity: "families",
    target: "selection",
    schema: FF_SPEC_SCHEMA,
    capture: "families.capture",
    apply: "families.apply",
    captureInput: (ctx) => ({ familyIds: ctx.page.selection.map(Number) }),
    plan: {
      // The host plans the Work's spec over the Work's scope, so the page's member becomes Work first.
      read: async (ctx, source) => {
        const doc = ctx.work.doc;
        if (!doc) throw Error("Current authored Families Work is required");
        const spec = { pod: source.pod, path: source.path };
        if (canonicalRouteInput(doc.spec) !== canonicalRouteInput(spec))
          await ctx.write([
            { path: ["spec"], value: spec },
            { path: ["excludedIds"], value: [] },
          ]);
        await readFamilyCapture("families.plan", {}, ctx.work.key as WorkKey, targetOf(ctx));
        return null;
      },
      sheet: familiesSheetOf,
      excluded: (view) => (view.work.doc?.excludedIds ?? []).map(String),
      confirm: async (ctx, sheet, included) => {
        if (!sheet.id || ctx.work.revision === null)
          throw Error("A current reviewed Families plan is required");
        actionResult(
          await runSemanticAction(
            "families.apply",
            semanticActionInput("families.apply", {
              planId: sheet.id,
              expectedPlanHashes: Object.fromEntries(included.map((row) => [row.id, row.planHash])),
            }),
            targetOf(ctx),
            { work: { key: ctx.work.key, revision: ctx.work.revision } },
          ),
        );
      },
    },
    docs: "Audit loaded families over a scope, capture picked families into a pod as specs, then plan a saved spec and confirm exactly which families it changes.",
  };

export const manifest = entityRoute<
  FamiliesRouteDocument,
  FamiliesReadingKey,
  FamiliesPage,
  "scope"
>(familiesSpec, {
  work: familiesRouteState,
  readings: {
    families: (_page: FamiliesPage, work: WorkKey) => ({ kind: "family-readings", work }),
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
      dirties: ["families"],
      stage: "audit",
      count: (ctx) => ctx.page.draft.categories.length || null,
      ready: (ctx) => (ctx.page.draft.categories.length ? null : "Pick a category first"),
      run: async (ctx) => {
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
  },
  seeds: FAMILIES_SEEDS as never,
});
