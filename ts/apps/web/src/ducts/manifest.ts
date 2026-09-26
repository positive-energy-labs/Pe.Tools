/**
 * The static /ducts contract: read every duct network of one document, choose one as the subject,
 * and stage the assumptions that make it solvable. Read-only toward Revit: the one fetch verb is
 * `refresh`, the one Reading is `ducts` (`ducts.snapshot`), and Work holds assumptions only.
 * Readiness under those assumptions is derived (`readiness.ts`), never stored.
 */
import { z } from "zod";
import { ductsRouteState, type DuctAssumption, type DuctsRouteDocument } from "@pe/agent-contracts";

import { defineRoute } from "#/route/manifest";

const DUCTS_STAGES = [{ key: "survey", word: "Surveying ducts" }] as const;

const ductsPageSchema = z.object({
  stage: z.enum(["survey"]).default("survey"),
  /** The view the body draws: "" the tables, `plan` one level, `iso` every level. */
  view: z.string().default(""),
  /** The subject: one group id (`g<smallest element id>`); empty = the whole document. */
  group: z.string().default(""),
  /** A level id as a string; empty = every level. */
  level: z.string().default(""),
  /** The layer keys the view draws, as `ducts.snapshot` names them. */
  layers: z.array(z.string()).default([]),
  /** The selected element id as a string; empty = none. */
  selected: z.string().default(""),
  /** The selected issue id (it may name no element: no-root, multi-root); empty = none. */
  issue: z.string().default(""),
  /** The spatial views' encoding, a key of `ENCODINGS` (`encoding.tsx`). */
  encoding: z.string().default("health"),
  /** Bumped by `refresh`; the snapshot read keys on it. */
  epoch: z.number().default(0),
});
export type DuctsPage = z.infer<typeof ductsPageSchema>;
export type DuctsReading = "ducts";

export const manifest = defineRoute<DuctsRouteDocument, DuctsReading, DuctsPage, "refresh">({
  key: "ducts",
  name: "Ducts",
  docs: "Read every duct network in the document by connector topology, choose one, and see what is known (sizes, flows, roughness, fan static, component drops) and what is missing before a pressure-loss solve. Assumptions you stage fill the gaps; nothing is written to Revit.",
  needs: "project",
  work: ductsRouteState,
  cells: [
    {
      segment: "assumptions",
      groupOf: (key) => [key.split(":")[0] ?? key],
      nouns: ["assumption"],
      noun: "duct assumptions",
      show: (value) => {
        const a = value as DuctAssumption;
        return a.kind === "verdict"
          ? a.verdict
          : a.kind === "flex-roughness"
            ? `${a.ft} ft`
            : `${a.inWg} in-wg`;
      },
    },
  ],
  // The snapshot is one host read the route owns (`route.tsx`), keyed on target, subject and epoch.
  readings: { ducts: () => null },
  page: ductsPageSchema,
  stages: DUCTS_STAGES,
  actions: {
    refresh: {
      label: "refresh",
      says: "Reads the duct snapshot of the document again",
      needs: "project",
      actor: "any",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: [],
      rereads: "ducts",
      ready: () => null,
      run: async (ctx) => ctx.setPage({ epoch: ctx.page.epoch + 1 }),
    },
  },
});
