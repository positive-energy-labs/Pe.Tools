/**
 * The Family route, declared once. The four authored families (`box`, `grd`, `bath`, `refline`)
 * are seeds — plain data, one per named family. The old demo-source store and the branches it fed
 * are deleted (fold 4).
 */
import { z } from "zod";
import {
  actionStatusSchema,
  familyActions,
  familyCaptureSchema,
  familyPlanReadingSchema,
  familyProjectionSchema,
  settingsDocumentIdSchema,
  settingsSnapshotSchema,
  type FamilyCapture,
  type FamilyDocument,
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

import { familyFixtures, type FamilyFixtureName } from "./authored-families";
import { FAMILY_MODULE } from "./host";
import {
  actionResult,
  readFamilyCapture,
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
}

export interface FamilyBuildReview {
  target: DocumentRef;
  documentId: z.infer<typeof settingsDocumentIdSchema>;
  workspaceId: string;
  fileVersion: string;
  reason: string;
}

export type FamilyAuthoringFacts = Omit<BuildFacts, "armedToken" | "boundTarget"> & {
  current: boolean;
};

export const familyPageSchema = z.object({
  stage: z.enum(["author", "evidence"]).default("author"),
  view: z.enum(["sheet", "anatomy", "drill", "inspector"]).default("sheet"),
  file: z.string().nullable().default(null),
  buildReview: z
    .object({
      documentId: settingsDocumentIdSchema,
      target: z.object({ session: z.string().min(1), openId: z.string().min(1) }),
      workspaceId: z.string().min(1),
      fileVersion: z.string().min(1),
      reason: z.string(),
    })
    .nullable()
    .default(null),
});

export type FamilyReadingKey = "family" | "profile" | "receipts" | "inventory";

type Ctx = RouteCtx<FamilyRouteDocument, FamilyReadingKey, FamilyPage>;
type ProjectedFamilyDocument = Omit<FamilyDocument, "plan"> & {
  plan?: (z.infer<typeof familyPlanReadingSchema> & { captureId: string }) | null;
};

/** The latest successful apply of one retained plan to this exact document lifetime. */
export function latestApplyStatus(
  rows: readonly FamilyCapture[],
  statuses: unknown,
  target: { session: string; openId: string },
) {
  if (!statuses) return null;
  return (
    actionStatusSchema
      .array()
      .parse(statuses)
      .filter(
        (row) =>
          row.key === "family.apply" &&
          row.state === "succeeded" &&
          row.destination.kind === "document" &&
          row.destination.ref.session === target.session &&
          row.destination.ref.openId === target.openId &&
          rows.some((capture) => capture.id === row.request.planId),
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
        return request.success && sameProfileIdentity(profile, request.data);
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
  statuses?: unknown,
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
    else if (capture.reading.kind === "capture" && capture.provenance.kind === "live") {
      result.evidence = familyProjectionSchema.shape.evidence.parse(capture.reading.value);
      result.plan = null;
    } else if (capture.reading.kind === "plan" && capture.provenance.kind === "live")
      result.plan = { ...capture.reading.value, captureId: capture.id };
  }
  const applied = target ? latestApplyStatus(rows, statuses, target) : null;
  if (result.plan?.captureId === applied?.request.planId) result.plan = null;
  return result;
}

/** The live plan for the bound family document, read from the `family` capture stream. */
const planOf = (ctx: Ctx) => {
  const raw = previousOf(ctx.readings.family);
  if (!raw || ctx.target.kind !== "document") return null;
  const rows = familyCaptureSchema.array().parse(raw);
  return projectReadings(rows, ctx.target.ref, previousOf(ctx.readings.receipts)).plan ?? null;
};

/** The authored file the verbs act on; null when none is open. */
const fileOf = (ctx: Ctx) =>
  ctx.page.file ? { documentId: { ...FAMILY_MODULE, relativePath: ctx.page.file } } : null;
const NO_FILE = "Open an authored family.json first";

const profileOf = (ctx: Ctx) =>
  settingsSnapshotSchema.safeParse(previousOf(ctx.readings.profile)).data ?? null;

const profileInputOf = (ctx: Ctx) => {
  const profile = profileOf(ctx);
  return profile?.workspaceId && profile.versionToken
    ? {
        documentId: profile.documentId,
        workspaceId: profile.workspaceId,
        fileVersion: profile.versionToken,
      }
    : null;
};

const sameProfileIdentity = (
  left: z.infer<typeof familyPlanReadingSchema> | FamilyBuildReview,
  profile: NonNullable<ReturnType<typeof profileInputOf>>,
) =>
  left.documentId.moduleKey === profile.documentId.moduleKey &&
  left.documentId.rootKey === profile.documentId.rootKey &&
  left.documentId.relativePath === profile.documentId.relativePath &&
  left.workspaceId === profile.workspaceId &&
  left.fileVersion === profile.fileVersion;

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("An open family document is required");
  return ctx.target.ref;
};

/** Family captures belong to the authored file workspace, independently of the open Revit file. */
const familyCaptureWork = (work: WorkKey): WorkKey | null =>
  work.work ? { route: "family", target: null, work: work.work } : null;

const captureScopeOf = (ctx: Ctx): WorkKey => {
  const work = familyCaptureWork(ctx.work.key);
  if (!work) throw Error("An authored file workspace is required");
  return work;
};

const read = async (
  ctx: Ctx,
  key: "family.capture" | "family.plan",
  input: Record<string, unknown>,
) => {
  await ctx.external(async () => {
    await readFamilyCapture(key, input, captureScopeOf(ctx), targetOf(ctx));
  });
};

const run = async (
  ctx: Ctx,
  key: "family.build" | "family.apply",
  input: Record<string, unknown>,
) => {
  await ctx.external(async () => {
    actionResult(await runSemanticAction(key, semanticActionInput(key, input), targetOf(ctx)));
  });
};

const emptyWork: FamilyRouteDocument = {};
const emptyInventory = { sessions: [] } satisfies {
  sessions: readonly BridgeSessionListEntry[];
};

/** One seed per named fixture family; the raw authored JSON is the seed's `profile` Reading. */
const familySeed = (
  name: FamilyFixtureName,
  view: FamilyPage["view"],
): Seed<FamilyRouteDocument, FamilyReadingKey, FamilyPage> => ({
  title: `${name} — authored family fixture`,
  work: emptyWork,
  readings: {
    profile: {
      documentId: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: name },
      path: `${name}.family.json`,
      workspaceId: "demo",
      versionToken: "fixture-native-v1",
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
  page: { stage: "author", view, file: `${name}.family.json`, buildReview: null },
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

export const familyManifest = (authoring = absentAuthoringFacts) =>
  defineRoute({
    key: "family",
    name: "Family",
    needs: "document",
    readings: {
      family: (_page: FamilyPage, work: WorkKey) => {
        const scope = familyCaptureWork(work);
        return scope ? { kind: "family-readings", work: scope } : null;
      },
      // FileWorkspace supplies this Reading from its supported settings.document.open authority.
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
            !sameProfileIdentity(review, profile)
          )
            return "Review the current saved family profile";
          return (
            buildRefusals({
              ...authoring,
              boundTarget: ctx.target.ref.session,
              armedToken: review.fileVersion,
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
            !sameProfileIdentity(review, profile)
          )
            throw Error("The current reviewed family profile is required");
          await run(ctx, "family.build", profile);
          ctx.setPage({ buildReview: null });
        },
      },
      capture: {
        label: "capture evidence",
        says: "Capture the current family's evidence from the bound document.",
        needs: "family",
        actor: "any",
        input: z.record(z.string(), z.unknown()).optional(),
        dirties: ["family"],
        stage: "evidence",
        ready: (ctx: Ctx) => (ctx.work.key.work ? null : "Open an authored family workspace first"),
        run: async (ctx: Ctx, input?: Record<string, unknown>) => {
          await read(ctx, "family.capture", input ?? {});
        },
      },
      plan: {
        label: "plan",
        says: "Plan the authored family edits against the bound family document.",
        needs: "family",
        actor: "any",
        input: z.record(z.string(), z.unknown()).optional(),
        dirties: ["family"],
        requires: { readings: ["profile"] },
        stage: "evidence",
        ready: (ctx: Ctx) =>
          !fileOf(ctx)
            ? NO_FILE
            : profileInputOf(ctx)
              ? null
              : "Wait for the current saved family profile",
        run: async (ctx: Ctx, input?: Record<string, unknown>) => {
          const profile = profileInputOf(ctx);
          if (!profile) throw Error("The current saved family profile is required");
          await read(ctx, "family.plan", { ...input, ...profile });
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
          if (!plan) return "Plan first";
          const profile = profileInputOf(ctx);
          if (!profile || !sameProfileIdentity(plan, profile))
            return "Plan the current saved family profile";
          return plan.entry.refusals.length
            ? `The plan carries ${plan.entry.refusals.length} refusals`
            : null;
        },
        run: async (ctx: Ctx, input?: Record<string, unknown>) => {
          const plan = planOf(ctx);
          if (!plan) throw Error("Plan first");
          await run(ctx, "family.apply", {
            ...input,
            planId: plan.captureId,
            expectedPlanHash: plan.entry.planHash,
          });
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
