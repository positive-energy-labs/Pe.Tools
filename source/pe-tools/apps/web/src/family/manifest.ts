/**
 * The Family route, declared once. The four authored families (`box`, `grd`, `bath`, `refline`)
 * are seeds — plain data, one per named family. The old demo-source store and the branches it fed
 * are deleted (fold 4).
 */
import { z } from "zod";
import {
  actionStatusSchema,
  familyActions,
  familyProjectionSchema,
  ffPlanEntrySchema,
  podMemberSourceSchema,
  settingsSnapshotSchema,
  type FamilyCapture,
  type FamilyDocument,
  type PodMemberSource,
  type Seed,
  type WorkKey,
  type DocumentRef,
} from "@pe/agent-contracts";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";
import { buildRefusals, type BuildFacts } from "./build";

/** Family edits the selected Settings Work; its own route has no authored document. */
type FamilyRouteDocument = Record<string, never>;

import {
  defineRoute,
  semanticActionFacts,
  semanticActionInput,
  type Ctx as RouteCtx,
} from "#/route";
import { previousOf } from "#/readings";

import { familyFixtures, type AuthoredFamilyName } from "./authored-families";
import {
  actionResult,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

type FamilyStage = "author" | "evidence";

export interface FamilyPage {
  /** The Situation's first word: authoring the file, or reconciling it with the open family. */
  stage: FamilyStage;
  view: "sheet" | "anatomy" | "drill" | "inspector";
  /** The authored family.json the verbs act on; the store mirrors the opened settings file here. */
  file: string | null;
  /** The exact saved profile and operator intent reviewed before a build may leave the page. */
  buildReview: FamilyBuildReview | null;
  /** The confirmation sheet of apply (dogma law 9): the host's plan for these exact bytes. */
  plan: FamilyPlan | null;
}

export interface FamilyBuildReview {
  target: DocumentRef;
  source: PodMemberSource;
  reason: string;
}

const familyPlanSchema = z.object({
  target: z.object({ session: z.string().min(1), openId: z.string().min(1) }),
  source: podMemberSourceSchema,
  entry: ffPlanEntrySchema,
});
export type FamilyPlan = z.infer<typeof familyPlanSchema>;

export type FamilyAuthoringFacts = Omit<BuildFacts, "armedToken" | "boundTarget"> & {
  current: boolean;
};

export const familyPageSchema = z.object({
  stage: z.enum(["author", "evidence"]).default("author"),
  view: z.enum(["sheet", "anatomy", "drill", "inspector"]).default("sheet"),
  file: z.string().nullable().default(null),
  buildReview: z
    .object({
      source: podMemberSourceSchema,
      target: z.object({ session: z.string().min(1), openId: z.string().min(1) }),
      reason: z.string(),
    })
    .nullable()
    .default(null),
  plan: familyPlanSchema.nullable().default(null),
});

export type FamilyReadingKey = "family" | "profile" | "receipts" | "inventory";

type Ctx = RouteCtx<FamilyRouteDocument, FamilyReadingKey, FamilyPage>;
type ProjectedFamilyDocument = Omit<FamilyDocument, "plan">;

/** The latest successful apply (a `family.apply` with a plan hash) to this exact document lifetime. */
export function latestApplyStatus(statuses: unknown, target: { session: string; openId: string }) {
  if (!statuses) return null;
  return (
    actionStatusSchema
      .array()
      .parse(statuses)
      .filter(
        (row) =>
          row.key === "family.apply" &&
          row.state === "succeeded" &&
          typeof row.request.planHash === "string" &&
          row.destination.kind === "document" &&
          row.destination.ref.session === target.session &&
          row.destination.ref.openId === target.openId,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
}

/** The latest successful build of this exact saved profile at this document lifetime. */
export function latestBuildStatus(
  statuses: unknown,
  target: { session: string; openId: string },
  profile: FamilyBuildReview,
) {
  if (!statuses) return null;
  return (
    actionStatusSchema
      .array()
      .parse(statuses)
      .filter((row) => {
        if (
          row.key !== "family.build" ||
          row.state !== "succeeded" ||
          row.destination.kind !== "document" ||
          row.destination.ref.session !== target.session ||
          row.destination.ref.openId !== target.openId
        )
          return false;
        const request = familyActions["family.build"].input.safeParse(row.request);
        return request.success && sameSource(profile.source, request.data.source);
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null
  );
}

/**
 * The family Readings, folded newest-last into one document. A live capture from another open
 * document is skipped: evidence belongs to the lifetime that produced it.
 */
export function projectReadings(
  rows: readonly FamilyCapture[],
  target?: { session: string; openId: string },
): ProjectedFamilyDocument {
  const result: ProjectedFamilyDocument = { bindings: {} };
  for (const capture of [...rows].reverse()) {
    if (
      capture.provenance.kind === "live" &&
      (!target ||
        capture.provenance.target.session !== target.session ||
        capture.provenance.target.openId !== target.openId)
    )
      continue;
    if (capture.reading.kind === "spec")
      result.doc = familyProjectionSchema.shape.doc.parse(capture.reading.value);
  }
  return result;
}

/** The confirmation sheet, only while it names this document and these exact saved bytes. */
export const planOf = (ctx: Ctx) => {
  const plan = ctx.page.plan;
  const profile = profileInputOf(ctx);
  return plan &&
    profile &&
    ctx.target.kind === "document" &&
    plan.target.session === ctx.target.ref.session &&
    plan.target.openId === ctx.target.ref.openId &&
    sameSource(plan.source, profile.source)
    ? plan
    : null;
};

/** The authored file the verbs act on; null when none is open. */
const fileOf = (ctx: Ctx) => ctx.page.file;
const NO_FILE = "Open an authored family.json first";

const profileOf = (ctx: Ctx) =>
  settingsSnapshotSchema.safeParse(previousOf(ctx.readings.profile)).data ?? null;

/** The saved member the verbs act on: its address and the exact bytes read. */
const profileInputOf = (ctx: Ctx) => {
  const profile = profileOf(ctx);
  return profile?.sha256 ? { source: { ...profile.member, sha256: profile.sha256 } } : null;
};

export const sameSource = (left: PodMemberSource, right: PodMemberSource) =>
  left.pod === right.pod && left.path === right.path && left.sha256 === right.sha256;

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("An open family document is required");
  return ctx.target.ref;
};

/** Family readings belong to the authored file workspace, independently of the open Revit file. */
const familyCaptureWork = (work: WorkKey): WorkKey | null =>
  work.work ? { route: "family", target: null, work: work.work } : null;

const run = async (
  ctx: Ctx,
  key: "family.build" | "family.apply" | "family.capture",
  input: Record<string, unknown>,
) =>
  actionResult(
    await runSemanticAction(key, semanticActionInput(key, input), targetOf(ctx)),
  ) as Record<string, unknown>;

const emptyWork: FamilyRouteDocument = {};
const emptyInventory = { sessions: [] } satisfies {
  sessions: readonly BridgeSessionListEntry[];
};

/** One seed per named fixture family; the raw authored JSON is the seed's `profile` Reading. */
const familySeed = (
  name: AuthoredFamilyName,
  view: FamilyPage["view"],
): Seed<FamilyRouteDocument, FamilyReadingKey, FamilyPage> => ({
  title: `${name} — authored family fixture`,
  work: emptyWork,
  readings: {
    profile: {
      member: { pod: "demo", path: `settings/family/${name}.json` },
      sha256: "fixture-native-v1",
      observedAt: "2026-09-06T00:00:00Z",
      rawContent: familyFixtures[name],
    },
    // The `family` Reading is the family-readings CAPTURE stream (`store.ts` parses it with
    // `familyCaptureSchema.array()`), not the projected document the store folds out of it. The
    // seed used to hand over a projection and the route threw on mount; the authored fixture the
    // seed is ABOUT is the `profile` Reading above.
    family: [],
    receipts: [],
    inventory: emptyInventory,
  },
  page: {
    stage: "author",
    view,
    file: `settings/family/${name}.json`,
    buildReview: null,
    plan: null,
  },
});

const absentAuthoringFacts: FamilyAuthoringFacts = {
  relativePath: null,
  versionToken: null,
  validation: null,
  unsavedCount: 0,
  stagedCount: 0,
  current: false,
};

const buildInput = z
  .object({
    reason: z.string(),
  })
  .default({ reason: "" });

export const familyManifest = (
  authoring = absentAuthoringFacts,
  /** Capture files a new member; the page opens it. */
  openMember: (member: { pod: string; path: string }) => Promise<void> = async () => {},
) =>
  defineRoute({
    key: "family",
    name: "Family",
    docs: "Open the saved family profile, review the exact build target, then build and reconcile the resulting family evidence.",
    needs: "document",
    readings: {
      family: (_page: FamilyPage, work: WorkKey) => {
        const scope = familyCaptureWork(work);
        return scope ? { kind: "family-readings", work: scope } : null;
      },
      // FileWorkspace supplies this Reading from pod.member.read + pod.member.compose.
      profile: () => null,
      /** Every action receipt for the bound document; the apply fold reads only this. */
      receipts: { kind: "receipts", target: { session: "", openId: "" } },
      inventory: { kind: "inventory" },
    } as never,
    page: familyPageSchema,
    stages: [
      { key: "author", word: "Authoring" },
      { key: "evidence", word: "Reconciling" },
    ],
    actions: {
      "prepare-build": {
        label: "review build",
        says: "Review the exact saved family profile before building its .rfa.",
        needs: "document",
        actor: "human",
        input: buildInput,
        dirties: [],
        requires: { readings: ["profile"] },
        stage: "author",
        ready: (ctx: Ctx) => {
          if (!profileInputOf(ctx)) return "Wait for the current saved family profile";
          if (!authoring.current) return "Wait for current authored edits";
          const refusals = buildRefusals({
            ...authoring,
            boundTarget: ctx.target.kind === "document" ? ctx.target.ref.session : "",
            armedToken: null,
          });
          return refusals.map((refusal) => refusal.says).join(" · ") || null;
        },
        run: async (ctx: Ctx, input: z.infer<typeof buildInput>) => {
          const profile = profileInputOf(ctx);
          if (!profile || ctx.target.kind !== "document")
            throw Error("The current saved family profile and execution document are required");
          ctx.setPage({ buildReview: { target: ctx.target.ref, ...profile, ...input } });
        },
      },
      "cancel-build": {
        label: "cancel build",
        says: "Dismiss the current reviewed build without changing the family profile.",
        needs: "host",
        actor: "human",
        input: z.void(),
        dirties: [],
        stage: "author",
        ready: (ctx: Ctx) => (ctx.page.buildReview ? null : "No build is under review"),
        run: async (ctx: Ctx) => ctx.setPage({ buildReview: null }),
      },
      build: {
        label: "build .rfa",
        ...semanticActionFacts("family.build"),
        input: z.void(),
        dirties: ["family"],
        requires: { readings: ["profile"] },
        stage: "author",
        ready: (ctx: Ctx) => {
          const review = ctx.page.buildReview;
          if (!review) return "Review build first";
          if (!authoring.current) return "Wait for current authored edits";
          const profile = profileInputOf(ctx);
          if (
            ctx.target.kind !== "document" ||
            ctx.target.ref.session !== review.target.session ||
            ctx.target.ref.openId !== review.target.openId ||
            !profile ||
            !sameSource(review.source, profile.source)
          )
            return "Review the current saved family profile";
          return (
            buildRefusals({
              ...authoring,
              boundTarget: ctx.target.ref.session,
              armedToken: review.source.sha256,
            })
              .map((refusal) => refusal.says)
              .join(" · ") || null
          );
        },
        run: async (ctx: Ctx) => {
          const profile = profileInputOf(ctx);
          const review = ctx.page.buildReview;
          if (
            !profile ||
            !review ||
            ctx.target.kind !== "document" ||
            ctx.target.ref.session !== review.target.session ||
            ctx.target.ref.openId !== review.target.openId ||
            !sameSource(review.source, profile.source)
          )
            throw Error("The current reviewed family profile is required");
          await run(ctx, "family.build", profile);
          ctx.setPage({ buildReview: null });
        },
      },
      capture: {
        label: "capture into pod",
        ...semanticActionFacts("family.capture"),
        input: z.record(z.string(), z.unknown()).optional(),
        dirties: ["family"],
        stage: "evidence",
        ready: (ctx: Ctx) =>
          profileOf(ctx) ? null : "Open a member so the capture knows which pod it lands in",
        run: async (ctx: Ctx) => {
          const pod = profileOf(ctx)?.member.pod;
          if (!pod) throw Error("Open a member so the capture knows which pod it lands in");
          const result = await run(ctx, "family.capture", { pod });
          const [member] = result.members as { pod: string; path: string }[];
          if (member) await openMember(member);
        },
      },
      plan: {
        label: "plan",
        says: "Plan the saved family spec against the bound family document; the plan is the confirmation apply needs.",
        needs: "family",
        actor: "human",
        input: z.record(z.string(), z.unknown()).optional(),
        dirties: [],
        requires: { readings: ["profile"] },
        stage: "evidence",
        ready: (ctx: Ctx) =>
          !fileOf(ctx)
            ? NO_FILE
            : profileInputOf(ctx)
              ? null
              : "Wait for the current saved family profile",
        run: async (ctx: Ctx) => {
          const profile = profileInputOf(ctx);
          if (!profile) throw Error("The current saved family profile is required");
          const result = await run(ctx, "family.apply", profile);
          ctx.setPage({
            plan: familyPlanSchema.parse({
              target: targetOf(ctx),
              source: profile.source,
              entry: result.plan,
            }),
          });
        },
      },
      apply: {
        label: "apply",
        ...semanticActionFacts("family.apply"),
        input: z.record(z.string(), z.unknown()).optional(),
        dirties: ["family"],
        requires: { readings: ["family", "profile", "receipts"] },
        stage: "evidence",
        count: (ctx: Ctx) => planOf(ctx)?.entry.changes.length ?? null,
        ready: (ctx: Ctx) => {
          const plan = planOf(ctx);
          if (!plan) return "Plan the current saved family profile first";
          return plan.entry.refusals.length
            ? `The plan carries ${plan.entry.refusals.length} refusals`
            : null;
        },
        run: async (ctx: Ctx) => {
          const plan = planOf(ctx);
          if (!plan) throw Error("Plan the current saved family profile first");
          await run(ctx, "family.apply", { source: plan.source, planHash: plan.entry.planHash });
          ctx.setPage({ plan: null });
        },
      },
    } as never,
    seeds: {
      plan: familySeed("box", "sheet"),
      apply: familySeed("grd", "sheet"),
      capture: familySeed("bath", "anatomy"),
      build: familySeed("refline", "drill"),
    } as never,
  });

export const manifest = familyManifest();
