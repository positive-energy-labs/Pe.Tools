/**
 * The Family route, declared once. The four authored families (`box`, `grd`, `bath`, `refline`)
 * are seeds — plain data, one per named family. The old demo-source store and the branches it fed
 * are deleted (fold 4).
 */
import { z } from "zod";
import { familyRouteState, type Seed } from "@pe/agent-contracts";

/** `familyRouteState.schema` is `z.object({})`: the route holds no authored Work of its own. */
type FamilyRouteDocument = Record<string, never>;

import { defineRoute, type Ctx as RouteCtx } from "#/route";

import { familyFixtures, type FamilyFixtureName } from "./authored-families";

export interface FamilyPage {
  view: "sheet" | "anatomy" | "drill" | "inspector";
  file: string | null;
}

export const familyPageSchema = z.object({
  view: z.enum(["sheet", "anatomy", "drill", "inspector"]).default("sheet"),
  file: z.string().nullable().default(null),
});

export type FamilyReadingKey = "family" | "profile" | "receipts" | "inventory";

type Ctx = RouteCtx<FamilyRouteDocument, FamilyReadingKey, FamilyPage>;

const emptyWork = familyRouteState.schema.parse({}) as FamilyRouteDocument;

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
      versionToken: "fixture-native-v1",
      observedAt: "2026-09-06T00:00:00Z",
      rawContent: familyFixtures[name],
    },
    // The `family` Reading is the family-readings CAPTURE stream (`store.ts:221` parses it with
    // `familyCaptureSchema.array()`), not the projected document the store folds out of it. The
    // seed used to hand over a projection and the route threw on mount; the authored fixture the
    // seed is ABOUT is the `profile` Reading above.
    family: [],
    receipts: [],
    inventory: [],
  },
  page: { view, file: `${name}.family.json` },
});

export const manifest = defineRoute({
  key: "family",
  name: "Family",
  needs: "family",
  work: familyRouteState,
  readings: {
    family: { kind: "family-readings", work: { route: "family", target: null } },
    profile: {
      kind: "file",
      id: { moduleKey: "FamilyFoundry", rootKey: "models", relativePath: "" },
    },
    /** Every action receipt for the bound document; the apply fold reads only this. */
    receipts: { kind: "receipts" },
    inventory: { kind: "inventory" },
  } as never,
  page: familyPageSchema,
  actions: {
    plan: {
      label: "plan family",
      says: "Plan the authored family edits against the bound family document.",
      needs: "family",
      actor: "any",
      input: z.record(z.string(), z.unknown()).optional(),
      dirties: ["family"],
      ready: () => null,
      run: async (ctx: Ctx, input?: Record<string, unknown>) => {
        await ctx.call("family.plan", input ?? {});
      },
    },
    apply: {
      label: "apply family",
      says: "Apply the planned family edits to the bound family document.",
      needs: "family",
      actor: "human",
      input: z.record(z.string(), z.unknown()).optional(),
      dirties: ["family", "profile"],
      ready: () => null,
      run: async (ctx: Ctx, input?: Record<string, unknown>) => {
        await ctx.call("family.apply", input ?? {});
      },
    },
    capture: {
      label: "capture evidence",
      says: "Capture the current family's evidence from the bound document.",
      needs: "family",
      actor: "any",
      input: z.record(z.string(), z.unknown()).optional(),
      dirties: ["family"],
      ready: () => null,
      run: async (ctx: Ctx, input?: Record<string, unknown>) => {
        await ctx.call("family.capture", input ?? {});
      },
    },
    build: {
      label: "build .rfa",
      says: "Build an .rfa from the authored family profile.",
      needs: "family",
      actor: "human",
      input: z.record(z.string(), z.unknown()).optional(),
      dirties: ["family", "profile"],
      ready: () => null,
      run: async (ctx: Ctx, input?: Record<string, unknown>) => {
        await ctx.call("family.build", input ?? {});
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
