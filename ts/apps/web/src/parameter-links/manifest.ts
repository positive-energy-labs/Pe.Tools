import type { Ctx as RouteCtx } from "#/route";
import { tools } from "@pe/agent-contracts";
import { presentation } from "#/route/presentation";
/**
 * The Parameter Links route, declared once. It has NO seeds by ruling (spec §7): the fixture
 * lane it used to carry is deleted, not ported, so `?demo=` is inert here.
 */
import { z } from "zod";
import {
  routeAddress,
  commands,
  type ParameterLinksDocument,
  type WorkKey,
  stagedParameterProfile,
} from "@pe/agent-contracts";

import {
  actionResult,
  readFamilyCapture,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

type ParameterLinksPage = z.infer<typeof parameterLinksPageSchema>;

const parameterLinksPageSchema = routeAddress("parameter-links").schema;

type ParameterLinksReadingKey = "links" | "receipts" | "inventory";
type ParameterLinksAction = "refresh" | "preview" | "previewProposal" | "apply";

type Ctx = RouteCtx<ParameterLinksDocument, ParameterLinksReadingKey, ParameterLinksPage>;

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("An open project document is required");
  return ctx.target.ref;
};

const read = async (ctx: Ctx, evaluate: boolean, subject: "edit" | "suggestion" = "edit") => {
  await readFamilyCapture(
    "parameter-links.read",
    { evaluate, ...(subject === "suggestion" ? { subject } : {}) },
    ctx.work.key,
    targetOf(ctx),
  );
};

export const manifest = presentation<
  ParameterLinksDocument,
  ParameterLinksReadingKey,
  ParameterLinksPage,
  ParameterLinksAction
>(tools["parameter-links"], {
  key: "parameter-links",
  name: "Parameter Links",
  docs: "Cross-element parameter links: Pea and you co-edit one draft profile of link definitions and assignments. Refresh re-reads the stored links, preview projects the draft's target writes, and the arming strip arms and commits apply.",
  needs: "project",
  readings: {
    links: (_page: ParameterLinksPage, work: WorkKey) => ({ kind: "family-readings", work }),
    receipts: (_page: ParameterLinksPage, work: WorkKey) => ({ kind: "receipts", work }),
    inventory: { kind: "inventory" },
  } as never,
  address: "parameter-links",
  page: parameterLinksPageSchema,
  actions: {
    refresh: {
      label: "refresh",
      says: "Read the stored parameter links of the bound project without evaluating the draft.",
      needs: "project",
      input: z.void() as never,
      dirties: ["links"],
      rereads: "links",
      ready: () => null,
      run: (ctx: Ctx) => read(ctx, false),
    },
    preview: {
      label: "preview",
      says: "Evaluate the shared draft and project its exact target writes.",
      needs: "project",
      input: z.void() as never,
      dirties: ["links"],
      requires: { work: true },
      ready: (ctx: Ctx) =>
        ctx.work.doc && stagedParameterProfile(ctx.work.doc) ? null : "save a draft first",
      run: (ctx: Ctx) => read(ctx, true),
    },
    previewProposal: {
      label: "preview Pea's suggestion",
      says: "Evaluate Pea's proposed profile — a labelled preview that never arms apply.",
      needs: "project",
      input: z.void() as never,
      dirties: ["links"],
      requires: { work: true },
      ready: (ctx: Ctx) =>
        ctx.work.doc?.profile.suggestion ? null : "Pea has proposed no profile",
      run: (ctx: Ctx) => read(ctx, true, "suggestion"),
    },
    apply: {
      label: "apply links",
      does: "parameter-links.apply",
      input: commands["parameter-links.apply"].input as never,
      dirties: ["links", "receipts"],
      requires: { work: true, readings: ["links"] },
      ready: () => null,
      run: async (ctx: Ctx, input: { readingId: string }) => {
        const { readingId } = input;
        actionResult(await ctx.commands["parameter-links.apply"]({ readingId }));
      },
    },
  },
});
