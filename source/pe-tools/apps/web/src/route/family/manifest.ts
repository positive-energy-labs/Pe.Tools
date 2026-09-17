/**
 * `/family`, declared once: an entity route whose audit is the family anatomy and parameter table.
 * The kernel owns capture and apply (and apply's plan confirmation); this file owns the audit's
 * Readings, its page memory, the build ceremony, and the four authored-family demo seeds.
 */
import { z } from "zod";
import {
  actionStatusSchema,
  familyActions,
  familyEvidenceSchema,
  familyProjectionSchema,
  podMemberSourceSchema,
  settingsSnapshotSchema,
  type ActionReceipt,
  type ActionStatus,
  type FamilyCapture,
  type FamilyDocument,
  type PodMemberSource,
  type Seed,
  type WorkKey,
  type DocumentRef,
} from "@pe/agent-contracts";
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";

import {
  entityRoute,
  semanticActionFacts,
  semanticActionInput,
  type Ctx as RouteCtx,
  type EntityPage,
  type EntityRouteDef,
  type PodRow,
} from "#/route";
import { previousOf } from "#/readings";
import { buildRefusals, type BuildFacts } from "#/family/build";
import { familyFixtures, type AuthoredFamilyName } from "#/family/authored-families";
import {
  actionResult,
  runSemanticAction,
} from "../../../../../packages/mcps/src/shared/takeoff-action-client";

/** The `$schema` path that says a member is a family model: the spec `/family` captures and applies. */
export const FAMILY_MODEL_SCHEMA = "/schemas/settings/FamilyFoundry/models.json";

/** Family edits the member's Settings Work; the route itself has no authored document. */
type FamilyRouteDocument = Record<string, never>;

export interface FamilyPage {
  view: "sheet" | "anatomy" | "drill" | "inspector";
  /** The exact saved profile and operator intent reviewed before a build may leave the page. */
  buildReview: FamilyBuildReview | null;
}

export interface FamilyBuildReview {
  target: DocumentRef;
  source: PodMemberSource;
  reason: string;
}

export type FamilyAuthoringFacts = Omit<BuildFacts, "armedToken" | "boundTarget"> & {
  current: boolean;
};

const familyPageSchema = z.object({
  view: z.enum(["sheet", "anatomy", "drill", "inspector"]).default("sheet"),
  buildReview: z
    .object({
      source: podMemberSourceSchema,
      target: z.object({ session: z.string().min(1), openId: z.string().min(1) }),
      reason: z.string(),
    })
    .nullable()
    .default(null),
});

export type FamilyReadingKey = "family" | "profile" | "receipts" | "inventory";
export type FamilyAction = "prepare-build" | "cancel-build" | "build";

type Ctx = RouteCtx<FamilyRouteDocument, FamilyReadingKey, FamilyPage>;

/** `/family` as a kernel definition. */
export const familySpec: EntityRouteDef<FamilyRouteDocument, FamilyReadingKey, FamilyPage> = {
  key: "family",
  name: "Family",
  entity: "family",
  target: "document",
  schema: FAMILY_MODEL_SCHEMA,
  capture: "family.capture",
  apply: "family.apply",
  confirm: true,
  docs: "Audit one family model beside its Revit family: capture the open family into a pod, edit the saved model, plan and apply it, or build it to an .rfa.",
};

const latestOf = (rows: ActionStatus[]) =>
  rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

const onTarget = (row: ActionStatus, target: { session: string; openId: string }) =>
  row.destination.kind === "document" &&
  row.destination.ref.session === target.session &&
  row.destination.ref.openId === target.openId;

const statusesOf = (statuses: unknown) =>
  statuses ? actionStatusSchema.array().parse(statuses) : [];

/** The latest successful apply (a `family.apply` with a plan hash) to this exact document lifetime. */
export const latestApplyStatus = (statuses: unknown, target: { session: string; openId: string }) =>
  latestOf(
    statusesOf(statuses).filter(
      (row) =>
        row.key === "family.apply" &&
        row.state === "succeeded" &&
        typeof row.request.planHash === "string" &&
        onTarget(row, target),
    ),
  );

/** The latest successful capture from this exact document lifetime. */
export const latestCaptureStatus = (
  statuses: unknown,
  target: { session: string; openId: string },
) =>
  latestOf(
    statusesOf(statuses).filter(
      (row) => row.key === "family.capture" && row.state === "succeeded" && onTarget(row, target),
    ),
  );

/** The latest successful build of this exact saved profile at this document lifetime. */
export const latestBuildStatus = (
  statuses: unknown,
  target: { session: string; openId: string },
  profile: FamilyBuildReview,
) =>
  latestOf(
    statusesOf(statuses).filter((row) => {
      if (row.key !== "family.build" || row.state !== "succeeded" || !onTarget(row, target))
        return false;
      const request = familyActions["family.build"].input.safeParse(row.request);
      return request.success && sameSource(profile.source, request.data.source);
    }),
  );

/**
 * What a capture saw, from its original receipt: the member it filed and the capture evidence
 * (coverage, unmodeled facts). Null when the receipt is not a finished capture.
 */
export function captureEvidence(receipts: unknown, id: string) {
  const row = (receipts as ActionReceipt[] | undefined)?.find((entry) => entry.id === id);
  const result = z
    .object({
      member: z.object({ pod: z.string(), path: z.string(), sha256: z.string() }),
      evidence: familyEvidenceSchema,
    })
    .safeParse((row as { result?: unknown } | undefined)?.result);
  return result.success ? result.data : null;
}

/**
 * The family Readings, folded newest-last into one document. A live capture from another open
 * document is skipped: evidence belongs to the lifetime that produced it.
 */
export function projectReadings(
  rows: readonly FamilyCapture[],
  target?: { session: string; openId: string },
): Omit<FamilyDocument, "plan"> {
  const result: Omit<FamilyDocument, "plan"> = { bindings: {} };
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

const profileOf = (ctx: Ctx) =>
  settingsSnapshotSchema.safeParse(previousOf(ctx.readings.profile)).data ?? null;

/** The saved member the build acts on: its address and the exact bytes read. */
const profileInputOf = (ctx: Ctx) => {
  const profile = profileOf(ctx);
  return profile?.sha256 ? { source: { ...profile.member, sha256: profile.sha256 } } : null;
};

export const sameSource = (left: PodMemberSource, right: PodMemberSource) =>
  left.pod === right.pod && left.path === right.path && left.sha256 === right.sha256;

/** Family spec readings (parsed documents) belong to the member's Work, not the open Revit file. */
const familyCaptureWork = (work: WorkKey): WorkKey | null =>
  work.work ? { route: "family", target: null, work: work.work } : null;

const emptyWork: FamilyRouteDocument = {};
const emptyInventory = { sessions: [] } satisfies {
  sessions: readonly BridgeSessionListEntry[];
};

const DEMO_POD = "demo";
const demoPath = (name: AuthoredFamilyName) => `settings/family/${name}.json`;
const demoHash = (n: number) => String(n).repeat(64);
const FAMILY_NAMES = ["box", "grd", "bath", "refline"] as const satisfies AuthoredFamilyName[];

/** The demo pod: the four authored fixtures, each a family model member. */
export const FAMILY_DEMO_PODS: readonly PodRow[] = [
  {
    id: DEMO_POD,
    name: "Demo families",
    version: "0.1.0",
    folder: "Documents/Pe.Tools/Pods/demo",
    entrypoints: [],
    members: FAMILY_NAMES.map((name, index) => ({
      path: demoPath(name),
      sha256: demoHash(index + 1),
      schema: `http://127.0.0.1:5180${FAMILY_MODEL_SCHEMA}`,
    })),
    diagnostics: [],
  },
];

/** One seed per kernel stage; the raw authored JSON is the seed's `profile` Reading. */
const familySeed = (
  name: AuthoredFamilyName,
  view: FamilyPage["view"],
  stage: "audit" | "capture" | "apply",
): Seed<FamilyRouteDocument, FamilyReadingKey | "pods", FamilyPage & EntityPage> => ({
  title: `${name} — authored family fixture`,
  work: emptyWork,
  readings: {
    profile: {
      member: { pod: DEMO_POD, path: demoPath(name) },
      sha256: demoHash(FAMILY_NAMES.indexOf(name) + 1),
      observedAt: "2026-09-06T00:00:00Z",
      rawContent: familyFixtures[name],
      // A fixture has no directives, so its composition is its bytes.
      composedContent: familyFixtures[name],
      validation: { isValid: true, issues: [] },
    },
    // The capture stream carries parsed spec documents only; the seed has none.
    family: [],
    receipts: [],
    inventory: emptyInventory,
    pods: FAMILY_DEMO_PODS,
  },
  page: { view, buildReview: null, stage, pod: DEMO_POD, path: demoPath(name) },
});

const absentAuthoringFacts: FamilyAuthoringFacts = {
  relativePath: null,
  versionToken: null,
  validation: null,
  unsavedCount: 0,
  stagedCount: 0,
  current: false,
};

const buildInput = z.object({ reason: z.string() }).default({ reason: "" });

export const familyManifest = (authoring = absentAuthoringFacts) =>
  entityRoute<FamilyRouteDocument, FamilyReadingKey, FamilyPage, FamilyAction>(familySpec, {
    readings: {
      family: (_page: FamilyPage, work: WorkKey) => {
        const scope = familyCaptureWork(work);
        return scope ? { kind: "family-readings", work: scope } : null;
      },
      // The owner provides this from pod.member.read + pod.member.compose.
      profile: () => null,
      /** Every action receipt for the bound document: the capture, apply and build folds. */
      receipts: { kind: "receipts", target: { session: "", openId: "" } },
      inventory: { kind: "inventory" },
    } as never,
    page: familyPageSchema,
    actions: {
      "prepare-build": {
        label: "review build",
        says: "Review the exact saved family profile before building its .rfa.",
        needs: "document",
        actor: "human",
        input: buildInput,
        dirties: [],
        requires: { readings: ["profile"] },
        stage: "audit",
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
        stage: "audit",
        ready: (ctx: Ctx) => (ctx.page.buildReview ? null : "No build is under review"),
        run: async (ctx: Ctx) => ctx.setPage({ buildReview: null }),
      },
      build: {
        label: "build .rfa",
        ...semanticActionFacts("family.build"),
        input: z.void(),
        dirties: ["receipts"],
        requires: { readings: ["profile"] },
        stage: "audit",
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
          actionResult(
            await runSemanticAction(
              "family.build",
              semanticActionInput("family.build", profile),
              ctx.target.ref,
            ),
          );
          ctx.setPage({ buildReview: null });
        },
      },
    } as never,
    seeds: {
      build: familySeed("refline", "drill", "audit"),
      capture: familySeed("bath", "anatomy", "capture"),
      apply: familySeed("grd", "sheet", "apply"),
    } as never,
  });
