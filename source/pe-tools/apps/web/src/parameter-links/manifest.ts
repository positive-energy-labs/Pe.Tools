/**
 * The Parameter Links route, declared once. It has NO seeds by ruling (spec §7): the fixture
 * lane it used to carry is deleted, not ported, so `?demo=` is inert here.
 */
import { z } from "zod";
import {
  parameterLinksRouteState,
  type ParameterLinksDocument,
  type WorkKey,
} from "@pe/agent-contracts";

import {
  defineRoute,
  semanticActionFacts,
  semanticActionInputSchema,
  type Ctx as RouteCtx,
} from "#/route";
import {
  actionResult,
  readFamilyCapture,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";

export interface ParameterLinksPage {
  view: "links" | "plan";
}

export const parameterLinksPageSchema = z.object({
  view: z.enum(["links", "plan"]).default("links"),
});

export type ParameterLinksReadingKey = "links" | "receipts" | "inventory";
export type ParameterLinksAction = "refresh" | "preview" | "apply";

type Ctx = RouteCtx<ParameterLinksDocument, ParameterLinksReadingKey, ParameterLinksPage>;

const targetOf = (ctx: Ctx) => {
  if (ctx.target.kind !== "document") throw Error("An open project document is required");
  return ctx.target.ref;
};

const read = async (ctx: Ctx, evaluate: boolean) => {
  await ctx.external(() =>
    readFamilyCapture("parameter-links.read", { evaluate }, ctx.work.key, targetOf(ctx)),
  );
};

export const manifest = defineRoute<
  ParameterLinksDocument,
  ParameterLinksReadingKey,
  ParameterLinksPage,
  ParameterLinksAction
>({
  key: "parameter-links",
  name: "Parameter Links",
  needs: "project",
  work: parameterLinksRouteState,
  readings: {
    links: (_page: ParameterLinksPage, work: WorkKey) => ({ kind: "family-readings", work }),
    receipts: { kind: "receipts" },
    inventory: { kind: "inventory" },
  } as never,
  page: parameterLinksPageSchema,
  actions: {
    refresh: {
      label: "refresh",
      says: "Read the stored parameter links of the bound project without evaluating the draft.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["links"],
      ready: () => null,
      run: (ctx: Ctx) => read(ctx, false),
    },
    preview: {
      label: "preview",
      says: "Evaluate the shared draft and project its exact target writes.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["links"],
      requires: { work: true },
      ready: (ctx: Ctx) => (ctx.work.doc?.draft ? null : "save a draft first"),
      run: (ctx: Ctx) => read(ctx, true),
    },
    apply: {
      label: "apply links",
      ...semanticActionFacts("parameter-links.apply"),
      input: semanticActionInputSchema("parameter-links.apply") as never,
      dirties: ["links", "receipts"],
      requires: { work: true, readings: ["links"] },
      ready: () => null,
      run: async (ctx: Ctx, input: { readingId: string }) => {
        const revision = ctx.work.revision;
        if (revision === null) throw Error("Parameter Links Work unavailable");
        const { readingId } = input;
        await ctx.external(async () => {
          actionResult(
            await runSemanticAction(
              "parameter-links.apply",
              { readingId },
              targetOf(ctx),
              { work: { key: ctx.work.key, revision } },
              "human",
            ),
          );
        });
      },
    },
  } as never,
  seeds: {} as never,
});
