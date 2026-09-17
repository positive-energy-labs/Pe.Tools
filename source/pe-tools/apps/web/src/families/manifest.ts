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
import {
  admissionPlan,
  entityRoute,
  workflow,
  type EntityPage,
  type EntityRouteDef,
  type MemberSource,
  type PlanEntry,
} from "#/route";
import { podHost } from "#/route/pods";

import type { FamiliesDraft } from "./host";
import { FAMILIES_SEEDS } from "./seeds";
import { stagedMembers } from "./staged";

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

/** The generated member's `$schema`: this library, on the host actually serving the page. */
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
    // `families.confirm` plans the page's member over the Work's scope; apply sends the included hashes.
    plan: {
      ...admissionPlan<FamiliesRouteDocument, FamiliesReadingKey, FamiliesPage>(
        { confirm: "families.confirm", apply: "families.apply" },
        (plan) => ffPlanRow(ffPlanEntrySchema.parse(plan)),
        (work) => ({
          excludedIds: work.excludedIds,
          ...(work.executionOptions ? { executionOptions: work.executionOptions } : {}),
        }),
      ),
      // Held-back rows are authored Work; the sheet toggles them there.
      excluded: (view) => (view.work.doc?.excludedIds ?? []).map(String),
    },
    /**
     * The editable table's half. Plan generates one patch member per edited family, files it in the
     * page's pod through the same host writer capture uses, and plans each through
     * `families.confirm`; apply sends each included row's hash back to the member that produced it.
     * The person never named, saved, or opened a file — but one exists, and the receipt names it.
     */
    staged: {
      count: (ctx) => (ctx.work.doc?.edits ?? []).length,
      plan: async (ctx) => {
        const doc = ctx.work.doc;
        if (!doc || ctx.work.revision === null) throw Error("author the route's Work first");
        if (!ctx.page.pod) throw Error("choose the pod the generated spec lands in");
        const bases = { work: { key: ctx.work.key, revision: ctx.work.revision } };
        const entries: PlanEntry[] = [];
        const generated = stagedMembers(doc.edits, new Date(), stagedSchema());
        for (const member of generated) {
          const source = await podHost.write(
            { pod: ctx.page.pod, path: member.path },
            member.content,
          );
          // The page names the first generated member so the Situation can open what was written;
          // every member is still addressed per row, and each files its own run. Named only after
          // it exists: naming a path before the write lands makes the editor read a missing file.
          if (member === generated[0]) ctx.setPage({ path: member.path });
          const result = await workflow(
            "families.confirm",
            {
              source,
              excludedIds: doc.excludedIds,
              ...(doc.executionOptions ? { executionOptions: doc.executionOptions } : {}),
            },
            ctx,
            bases,
          );
          // The spec selects one family, but the engine plans what it matches: keep that family's
          // row and no other, so a row can never be attributed to a member that did not plan it.
          for (const plan of [result.plan].flat()) {
            const row = ffPlanRow(ffPlanEntrySchema.parse(plan));
            if (Number(row.id) === member.familyId) entries.push({ ...row, source });
          }
        }
        return { entries };
      },
      apply: async (ctx, included) => {
        const doc = ctx.work.doc;
        const byMember = new Map<string, { source: MemberSource; rows: PlanEntry[] }>();
        for (const row of included) {
          if (!row.source) throw Error(`the planned row for ${row.name} names no saved member`);
          const key = `${row.source.pod}:${row.source.path}`;
          const bucket = byMember.get(key);
          if (bucket) bucket.rows.push(row);
          else byMember.set(key, { source: row.source, rows: [row] });
        }
        for (const { source, rows } of byMember.values())
          await workflow(
            "families.apply",
            {
              source,
              ...(doc?.executionOptions ? { executionOptions: doc.executionOptions } : {}),
              expectedPlanHashes: Object.fromEntries(rows.map((r) => [r.id, r.planHash])),
            },
            ctx,
          );
        // Applied edits are spent: the run receipt is the record from here, and leaving them
        // staged would offer the same change again over a model that already took it.
        await ctx.write([{ path: ["edits"], value: [] }]);
      },
    },
    docs: "Audit loaded families over a scope, edit the cells a patch can express as staged work, capture picked families into a pod as specs, then plan a spec — saved or generated from the staged edits — and apply exactly the families it changes.",
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
