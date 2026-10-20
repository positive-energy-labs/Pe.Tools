/**
 * The static /ducts contract: read every duct network of one document, choose one as the subject,
 * stage the assumptions that make it solvable, then price its losses and write them to Revit.
 * Readings: `ducts` (`ducts.snapshot`) and `tables` (`ducts.tables`), both read by the route
 * (`host.ts`) and provided to the verbs. Readiness and losses are derived (`readiness.ts`,
 * `pricing.ts`), never stored. `preview` asks Revit what the staged cells would write; `apply`
 * sends the same request for real, armed only while the preview matches the Work revision and the
 * snapshot it was built on.
 */
import { z } from "zod";
import {
  ductsRouteState,
  transitionPatches,
  type DuctAssumption,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { defineRoute, semanticActionInput, type Ctx } from "#/route/manifest";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { ductsDocs } from "#/ducts/docs";
import {
  actionResult,
  readAction,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { DuctsApply } from "@pe/host-contracts/generated";
import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { applyRequest, price } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { triage, writeBlocked } from "./inbox-rows";

/** What Revit said the staged cells would write, and the Work and snapshot it was asked over. */
export interface DuctsEvaluation {
  revision: number;
  epoch: number;
  response: DuctsApply.Res.Response;
}

const ductsPageSchema = z.object({
  /** The subject: one group id (`g<smallest element id>`); empty = the whole document. */
  group: z.string().default(""),
  /** A level id as a string; empty = every level. */
  level: z.string().default(""),
  /** The layer keys the picture draws, as `ducts.snapshot` names them, comma separated; empty = none. */
  layers: z.string().default(""),
  /** The selected element id as a string; empty = none. */
  selected: z.string().default(""),
  /** The selected issue id (it may name no element: no-root, multi-root); empty = none. Page, never URL. */
  issue: z.string().default(""),
  /** The picture's encoding, a key of `ENCODINGS` (`encoding.tsx`). */
  encoding: z.string().default("health"),
  /** The camera the model picture looks through: the isometric globe, or `plan` (a preset on it). */
  camera: z.enum(["iso", "plan"]).default("iso"),
  /** What the picture pane draws: the `model` in space, or the `schematic` one-line. */
  picture: z.enum(["model", "schematic"]).default("model"),
  /** Bumped by `refresh` and `apply`; the snapshot read keys on it. */
  epoch: z.number().default(0),
  /** The last preview; `apply` is armed while it matches the Work revision and epoch. Page, never URL. */
  evaluation: z.custom<DuctsEvaluation>().nullable().default(null),
});
export type DuctsPage = z.infer<typeof ductsPageSchema>;
/** The Page keys the address carries; every one has a default, so a bare `/ducts` is a page. */
export const DUCTS_URL = [
  "group",
  "level",
  "selected",
  "encoding",
  "layers",
  "camera",
  "picture",
] as const;
export type DuctsReading = "ducts" | "tables" | "catalogs";
type DuctsCtx = Ctx<DuctsRouteDocument, DuctsReading, DuctsPage>;

const observed = <T>(ctx: DuctsCtx, key: DuctsReading) => {
  const reading = ctx.readings[key];
  return reading?.state === "ready" ? (reading.observation as T) : null;
};

/** The segments `ducts.apply` writes; `assumptions`, `roles` and `loads` stay in Pe. */
export const WRITTEN = [
  "rules",
  "terminalDrops",
  "componentDrops",
  "flows",
  "esp",
  "equipmentFlows",
  "parameters",
] as const;
const stagedCells = (doc: DuctsRouteDocument | null) =>
  ([...WRITTEN, "catalogs"] as const).flatMap((segment) =>
    Object.entries(doc?.[segment] ?? {}).flatMap(([key, cell]) =>
      cell?.staged ? [{ segment, key, cell }] : [],
    ),
  );
/** Staged rulings (assumption verdicts, unit roles): route Work that no write carries. */
export const stagedRulings = (doc: DuctsRouteDocument | null) =>
  (["assumptions", "roles"] as const).reduce(
    (n, segment) => n + Object.values(doc?.[segment] ?? {}).filter((cell) => cell?.staged).length,
    0,
  );
/** How many staged cells a write would carry. */
export const stagedCount = (doc: DuctsRouteDocument | null) => stagedCells(doc).length;

/**
 * What stands between the Work and a write, in the inbox's own terms: the Fix and Set rows of the
 * chosen group (`triage`, the rows the Write group counts). Null when the snapshot or tables are
 * unread: nothing can be priced then, and the write fails on its own words.
 */
const standing = (ctx: DuctsCtx) => {
  const snapshot = observed<DuctSnapshot>(ctx, "ducts");
  const grids = observed<Grids>(ctx, "tables");
  if (!snapshot || !grids) return null;
  const priced = price(
    snapshot,
    grids,
    ctx.work.doc,
    observed<Catalogs>(ctx, "catalogs") ?? EMPTY_CATALOGS,
  );
  const { fix, set } = triage({
    snapshot: priced.snapshot,
    group: ctx.page.group,
    findings: priced.findings,
    flows: priced.flows,
    equipmentFlows: priced.equipmentFlows,
    doc: ctx.work.doc,
  });
  return { fix: fix.length, set: set.length };
};

/** The request from the staged cells, the snapshot and the grids the route read; throws why not. */
const built = (ctx: DuctsCtx) => {
  const snapshot = observed<DuctSnapshot>(ctx, "ducts");
  const grids = observed<Grids>(ctx, "tables");
  if (!snapshot) throw Error("The duct snapshot is not read yet");
  if (!grids) throw Error("The ASHRAE tables are not read yet");
  if (ctx.work.revision === null) throw Error("The Work is not read yet");
  if (snapshot.storeError)
    throw Error(`Pe's provenance store in this model is unreadable: ${snapshot.storeError}`);
  const priced = price(
    snapshot,
    grids,
    ctx.work.doc,
    observed<Catalogs>(ctx, "catalogs") ?? EMPTY_CATALOGS,
  );
  return applyRequest(snapshot, priced, new Date().toISOString(), ctx.page.group);
};

const dispatch = async (
  ctx: DuctsCtx,
  key: "ducts.preview-losses" | "ducts.apply-losses",
  input: Record<string, unknown>,
) => {
  if (ctx.target.kind !== "document") throw Error("An open document is required");
  // An apply on a large model runs about 45 s (the commits recalculate it). A
  // receipt that comes back detached or running is read again until it settles; the verb's
  // `waitSeconds` is the one bound, and past it the route ends the verb honestly.
  let row = await runSemanticAction(key, semanticActionInput(key, input), ctx.target.ref);
  while (row.state === "detached" || row.state === "running") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    row = (await readAction(row.id)) ?? row;
  }
  // The host answers `{ value, target }` (ducts-actions.ts); the value is the native op's answer.
  const answer = actionResult(row) as { value?: unknown };
  return (answer.value ?? answer) as DuctsApply.Res.Response;
};

const outcomeWords = (response: DuctsApply.Res.Response) =>
  Object.entries(response.counts)
    .filter(([, n]) => n)
    .map(([outcome, n]) => `${n} ${outcome}`)
    .join(" · ") || "nothing to write";

/** The preview still describes this Work revision and this snapshot. */
export const previewFresh = (page: DuctsPage, revision: number | null) =>
  page.evaluation !== null &&
  page.evaluation.revision === revision &&
  page.evaluation.epoch === page.epoch;

const why = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
const none = z.void() as unknown as z.ZodType<never>;

export const manifest = defineRoute<
  DuctsRouteDocument,
  DuctsReading,
  DuctsPage,
  "refresh" | "preview" | "apply"
>({
  key: "ducts",
  name: "Ducts",
  docs: ductsDocs,
  needs: "project",
  work: ductsRouteState,
  cells: [
    {
      segment: "calculation",
      groupOf: (key) => [key],
      nouns: ["calculation evidence"],
      noun: "calculation evidence",
      show: (value) => (value as { kind: string }).kind,
    },
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
    {
      segment: "rules",
      groupOf: (key) => [key],
      nouns: ["rule"],
      noun: "loss rules",
      show: (value) => (value as { table: string }).table,
    },
    {
      segment: "catalogs",
      groupOf: (key) => [key],
      nouns: ["catalog link"],
      noun: "grille catalog links",
      show: (value) => (value as { table: string }).table,
    },
    {
      segment: "terminalDrops",
      groupOf: (key) => [key],
      nouns: ["terminal"],
      noun: "terminal drops",
      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },
    {
      segment: "componentDrops",
      groupOf: (key) => [key],
      nouns: ["component"],
      noun: "component drops",
      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },
    {
      segment: "flows",
      groupOf: (key) => [key],
      nouns: ["terminal"],
      noun: "terminal flows",
      show: (value) => `${(value as { cfm: number }).cfm} cfm`,
    },
    {
      segment: "esp",
      groupOf: (key) => [key],
      nouns: ["unit"],
      noun: "unit ESPs",
      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },
    {
      segment: "equipmentFlows",
      groupOf: (key) => [key],
      nouns: ["unit"],
      noun: "unit flows",
      show: (value) => `${(value as { cfm: number }).cfm} cfm`,
    },
    {
      segment: "roles",
      groupOf: (key) => [key],
      nouns: ["unit"],
      noun: "unit roles",
      show: (value) => (value as { role: string }).role,
    },
    {
      segment: "parameters",
      groupOf: (key) => [key],
      nouns: ["slot"],
      noun: "parameter slots",
      show: (value) => String(value),
    },
  ],
  // Both are host reads the route owns (`host.ts`) and provides to the verbs: the snapshot keyed on
  // target, subject, slots and epoch; the tables on the session.
  readings: { ducts: () => null, tables: () => null, catalogs: () => null },
  page: ductsPageSchema,
  url: DUCTS_URL,
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
    preview: {
      label: "preview",
      does: "ducts.preview-losses",
      // The inbox's Write group draws it.
      visible: false,
      input: none,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      requires: { work: true },
      count: (ctx) => stagedCells(ctx.work.doc).length || null,
      ready: (ctx) => (stagedCells(ctx.work.doc).length ? why(() => built(ctx)) : "Nothing staged"),
      run: async (ctx) => {
        const request = built(ctx);
        const response = await dispatch(ctx, "ducts.preview-losses", request);
        ctx.setPage({
          evaluation: { revision: ctx.work.revision!, epoch: ctx.page.epoch, response },
        });
        ctx.note("preview", `Work r${ctx.work.revision}: ${outcomeWords(response)}`);
      },
    },
    apply: {
      label: "write to Revit",
      labelNow: (ctx) => {
        // Planned writes only: a refused write is not one apply makes.
        const n = ctx.page.evaluation?.response.counts.planned ?? 0;
        return previewFresh(ctx.page, ctx.work.revision) && n
          ? `write ${n} to Revit`
          : "write to Revit";
      },
      does: "ducts.apply-losses",
      // The inbox's Write group draws it; it arms there (Fix and Set empty, preview fresh).
      visible: false,
      input: none,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      requires: { work: true },
      // Armed only while Fix and Set are empty and the preview matches this Work and snapshot.
      ready: (ctx) =>
        !stagedCells(ctx.work.doc).length
          ? "Nothing staged"
          : (writeBlocked(standing(ctx) ?? { fix: 0, set: 0 }) ??
            (ctx.page.evaluation === null
              ? "Preview first"
              : !previewFresh(ctx.page, ctx.work.revision)
                ? "The staged Work or the snapshot changed since the preview; preview again"
                : null)),
      run: async (ctx) => {
        const applied = stagedCells(ctx.work.doc).filter((cell) => cell.segment !== "catalogs");
        const response = await dispatch(ctx, "ducts.apply-losses", built(ctx));
        ctx.note("apply", outcomeWords(response), response.counts.refused > 0);
        // The staged cells are in Revit now; the snapshot and its store are their home.
        const patches: RouteStatePatch[] = applied.flatMap(({ segment, key, cell }) =>
          transitionPatches([segment], key, cell, { kind: "unstage" }),
        );
        const refusal = await ctx.write(patches);
        ctx.setPage({ epoch: ctx.page.epoch + 1, evaluation: null });
        return refusal;
      },
    },
  },
});
