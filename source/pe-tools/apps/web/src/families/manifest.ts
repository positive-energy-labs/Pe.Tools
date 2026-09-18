/**
 * `/families`, declared once on the route kernel. The audit is the loaded-families matrix over an
 * authored scope, its cells open to proposals; capture files one spec member per picked family;
 * plan reads the page's member, or generates one member per family from accepted proposals, and
 * apply sends the sheet's included hashes. Work holds the scope, the proposals and their accepts,
 * and the rows a person held back.
 */
import { z } from "zod";
import {
  familiesRouteState,
  ffPlanEntrySchema,
  type FamiliesRouteDocument,
  type FamilyCellEdit,
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
import { isAccepted, stagedMembers } from "./staged";

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
    /**
     * The editable table's half. Plan takes ACCEPTED proposals only, generates one patch member per
     * family from them, files each in the page's pod through the same host writer capture uses, and
     * plans each through `families.plan` over exactly that family's id; apply sends each included
     * row's hash back to the member that produced it. The person never named, saved, or opened a
     * file — but one exists, the sheet names it per row, and the receipt names it.
     */
    staged: {
      count: (ctx) => (ctx.work.doc?.accepted ?? []).length,
      plan: async (ctx) => {
        const doc = ctx.work.doc;
        if (!doc || ctx.work.revision === null) throw Error("author the route's Work first");
        if (!ctx.page.pod) throw Error("choose the pod the generated spec lands in");
        const bases = { work: { key: ctx.work.key, revision: ctx.work.revision } };
        const entries: PlanEntry[] = [];
        const generated = stagedMembers(doc.accepted, new Date(), stagedSchema());
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
            "families.plan",
            {
              source,
              // The member selects one family by name; the plan names it by id, so the host plans
              // that family alone and never lays one family's types onto the rest of the scope.
              familyIds: [member.familyId],
              excludedIds: doc.excludedIds,
              ...(doc.executionOptions ? { executionOptions: doc.executionOptions } : {}),
            },
            ctx,
            bases,
          );
          // The sheet names the member each family applies from.
          for (const plan of [result.plan].flat()) {
            const row = ffPlanRow(ffPlanEntrySchema.parse(plan));
            entries.push({ ...row, detail: `${row.detail} · from ${member.path}`, source });
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
        // Applied proposals are spent: the run receipt is the record from here, and leaving them
        // standing would offer the same change again over a model that already took it. Proposals
        // nobody accepted, and families held back from this apply, stay.
        const applied = new Set(included.map((row) => Number(row.id)));
        const spent = (edit: FamilyCellEdit) => applied.has(edit.familyId);
        await ctx.write([
          {
            path: ["edits"],
            value: (doc?.edits ?? []).filter(
              (edit) => !spent(edit) || !isAccepted(doc!.accepted, edit),
            ),
          },
          { path: ["accepted"], value: (doc?.accepted ?? []).filter((edit) => !spent(edit)) },
        ]);
      },
    },
    docs: "Audit loaded families over a scope, propose values in the cells a patch can express and accept or deny each, capture picked families into a pod as specs, then plan a spec — saved, or generated from the accepted proposals — and apply exactly the families it changes.",
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
