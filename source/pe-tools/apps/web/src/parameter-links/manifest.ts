/**
 * The Parameter Links route, declared once. It has NO seeds by ruling (spec §7): the fixture
 * lane it used to carry is deleted, not ported, so `?demo=` is inert here.
 */
import { z } from "zod";

import { defineRoute, type Ctx as RouteCtx } from "#/route";

export interface ParameterLinksPage {
  view: "links" | "plan";
}

export const parameterLinksPageSchema = z.object({
  view: z.enum(["links", "plan"]).default("links"),
});

export type ParameterLinksReadingKey = "links" | "receipts" | "inventory";

type Ctx = RouteCtx<Record<string, never>, ParameterLinksReadingKey, ParameterLinksPage>;

const parameterLinksState = {
  route: "parameter-links",
  title: "Parameter Links",
  description: "Read parameter links in the bound project and apply the reviewed plan.",
  schema: z.object({}),
  agentWriteMask: [],
  commands: {},
};

export const manifest = defineRoute({
  key: "parameter-links",
  name: "Parameter Links",
  needs: "project",
  work: parameterLinksState as never,
  readings: {
    links: { kind: "family-readings", work: { route: "parameter-links", target: null } },
    receipts: { kind: "receipts" },
    inventory: { kind: "inventory" },
  } as never,
  page: parameterLinksPageSchema,
  actions: {
    read: {
      label: "read links",
      says: "Read the parameter links of the bound project.",
      needs: "project",
      actor: "any",
      input: z.void(),
      dirties: ["links"],
      ready: () => null,
      run: async (ctx: Ctx) => {
        await ctx.call("parameter-links.read", {});
      },
    },
    apply: {
      label: "apply links",
      says: "Apply the reviewed parameter-link plan.",
      needs: "project",
      actor: "human",
      input: z.void(),
      dirties: ["links", "receipts"],
      ready: () => null,
      run: async (ctx: Ctx) => {
        await ctx.call("parameter-links.apply", {});
      },
    },
  } as never,
  seeds: {} as never,
});
