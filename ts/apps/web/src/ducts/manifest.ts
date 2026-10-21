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
import type { DuctsApply, DuctsHeal } from "@pe/host-contracts/generated";
import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { applyRequest, price } from "@pe/ducts-domain/pricing";
import { pendingRulings, withStoredRulings } from "@pe/ducts-domain/rulings";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { healPlan, healRequestGroup } from "@pe/ducts-domain/heal";
import { survey } from "@pe/ducts-domain/survey";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { airflowOptions } from "./airflow";
import { groupLabels } from "./inputs";
import { holding, triage, writeBlocked } from "./inbox-rows";

/** What Revit said the staged cells would write, and the Work and snapshot it was asked over. */
export interface DuctsEvaluation {
  revision: number;
  epoch: number;
  response: DuctsApply.Res.Response;
}

/**
 * The last `ducts.heal` run: its group, preview or apply, the snapshot epoch it ran over, Revit's
 * answer, and Pe's ESP of the group before it with the roots and elements to find the group by
 * after Revit renumbers what it rebuilt.
 */
export interface DuctsHealRun {
  group: string;
  mode: "preview" | "apply";
  epoch: number;
  response: DuctsHeal.Res.Response;
  before: { esp: number | null; roots: number[]; ids: number[] };
}

const ductsPageSchema = z.object({
  /** The subject: a Revit system name (`SA 19`; `no system` for the groups none claims), read across
   * every group it is in (`system-scope.ts`); empty = the whole document. */
  system: z.string().default(""),
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
  /** The last heal preview or apply; the Heal row reads it. Page, never URL. */
  heal: z.custom<DuctsHealRun>().nullable().default(null),
});
export type DuctsPage = z.infer<typeof ductsPageSchema>;
/** The Page keys the address carries; every one has a default, so a bare `/ducts` is a page. */
export const DUCTS_URL = [
  "system",
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

/**
 * The segments `ducts.apply` writes to elements and the store; `loads` stays in Pe, and the rulings
 * (`assumptions` verdicts, `roles`) are written to the store as deltas (`pendingRulings`).
 */
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
type Store = DuctSnapshot["store"];
/** How many changes a write would carry: staged cells, and rulings that differ from the store's. */
export const pendingCount = (doc: DuctsRouteDocument | null, store: Store) =>
  stagedCells(doc).length + pendingRulings(doc, store).length;
const pendingOf = (ctx: DuctsCtx) =>
  pendingCount(ctx.work.doc, observed<DuctSnapshot>(ctx, "ducts")?.store);

/** The chosen system over a snapshot (`system-scope.ts`); null is the whole document. */
export const scopeOf = (snapshot: DuctSnapshot, page: Pick<DuctsPage, "system">) =>
  page.system ? systemScope(snapshot, page.system) : null;

/**
 * What stands between the Work and a write, in the inbox's own terms: the Fix and Set rows of the
 * chosen system (`triage`, the rows the Write group counts). Null when the snapshot or tables are
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
  // The survey may merge or bridge groups: the scope is read over the snapshot that was priced.
  const scope = scopeOf(priced.snapshot, ctx.page);
  const { fix, set } = triage({
    snapshot: priced.snapshot,
    scope,
    findings: priced.findings,
    flows: priced.flows,
    equipmentFlows: priced.equipmentFlows,
    doc: withStoredRulings(ctx.work.doc, snapshot.store),
    airflow: airflowOptions(priced.snapshot, scope),
    unitAirflow: airflowOptions(priced.snapshot, scope, "unit"),
    roles: priced.roles,
  });
  return { fix: holding(fix), set: set.length };
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
  // Write scope is the system: every group it is in, as the raw snapshot numbers them.
  const groups = ctx.page.system ? systemScope(snapshot, ctx.page.system).groups : [];
  if (ctx.page.system && !groups.length)
    throw Error(`No duct network in this snapshot carries ${ctx.page.system}`);
  return applyRequest(snapshot, priced, new Date().toISOString(), groups);
};

const dispatch = async <T = DuctsApply.Res.Response>(
  ctx: DuctsCtx,
  key: "ducts.preview-losses" | "ducts.apply-losses" | "ducts.preview-heal" | "ducts.apply-heal",
  input: Record<string, unknown>,
): Promise<T> => {
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
  return (answer.value ?? answer) as T;
};

/** A duct network in a person's words: its systems and units (`groupLabels`), never its group id. */
const networkWord = (snapshot: DuctSnapshot, group: string) =>
  groupLabels(snapshot).get(group) ?? "the duct network";

/** The group's heal plan over the raw snapshot the route read; throws why there is none. */
const healOf = (ctx: DuctsCtx, group: string | undefined) => {
  const snapshot = observed<DuctSnapshot>(ctx, "ducts");
  if (!snapshot) throw Error("The duct snapshot is not read yet");
  if (!group) throw Error("Name the duct network to heal");
  const found = healPlan(snapshot, ctx.work.doc).groups.find((g) => g.group === group);
  if (!found) throw Error(`Nothing in ${networkWord(snapshot, group)} heals in Revit`);
  return { snapshot, found };
};

/** Pe's ESP of a group now (the largest path total with the staged cells), with what finds it again. */
const espBefore = (ctx: DuctsCtx, snapshot: DuctSnapshot, group: string) => {
  const grids = observed<Grids>(ctx, "tables");
  const surveyed = grids
    ? price(snapshot, grids, ctx.work.doc, observed<Catalogs>(ctx, "catalogs") ?? EMPTY_CATALOGS)
    : survey(snapshot, ctx.work.doc);
  const g = surveyed.snapshot.groups.find((x) => x.id === group);
  const ids = [...surveyed.snapshot.nodes, ...surveyed.snapshot.segments]
    .filter((e) => e.groupId === group && e.id > 0)
    .map((e) => e.id);
  const esp = grids
    ? ((surveyed as ReturnType<typeof price>).next.byGroup[group]?.fan ?? null)
    : null;
  return { esp, roots: g?.rootIds ?? [], ids };
};

const healWords = (response: DuctsHeal.Res.Response) =>
  Object.entries(response.counts)
    .filter(([, n]) => n)
    .map(([outcome, n]) => `${n} ${outcome}`)
    .join(" · ") || "nothing to heal";

const healInput = z.object({ group: z.string() }) as unknown as z.ZodType<never>;
/** The group a heal verb names; undefined when the handle asks for the verb at large. */
const groupOf = (input: unknown) => (input as { group?: string } | undefined)?.group;

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
  "refresh" | "preview" | "apply" | "heal-preview" | "heal"
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
        const a = value as DuctAssumption | undefined;
        return !a
          ? "take back"
          : a.kind === "verdict"
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
      count: (ctx) => pendingOf(ctx) || null,
      ready: (ctx) => (pendingOf(ctx) ? why(() => built(ctx)) : "Nothing staged"),
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
        !pendingOf(ctx)
          ? "Nothing staged"
          : (writeBlocked(standing(ctx) ?? { fix: 0, set: 0 }) ??
            (ctx.page.evaluation === null
              ? "Preview first"
              : !previewFresh(ctx.page, ctx.work.revision)
                ? "The staged Work or the snapshot changed since the preview; preview again"
                : null)),
      run: async (ctx) => {
        const applied = stagedCells(ctx.work.doc).filter((cell) => cell.segment !== "catalogs");
        const rulings = pendingRulings(
          ctx.work.doc,
          observed<DuctSnapshot>(ctx, "ducts")?.store,
        ).map(({ segment, key }) => ({ segment, key, cell: ctx.work.doc![segment][key]! }));
        const response = await dispatch(ctx, "ducts.apply-losses", built(ctx));
        ctx.note("apply", outcomeWords(response), response.counts.refused > 0);
        // The staged cells are in Revit now and the rulings in its store; the snapshot is their home.
        const patches: RouteStatePatch[] = [...applied, ...rulings].flatMap(
          ({ segment, key, cell }) => transitionPatches([segment], key, cell, { kind: "unstage" }),
        );
        const refusal = await ctx.write(patches);
        ctx.setPage({ epoch: ctx.page.epoch + 1, evaluation: null });
        return refusal;
      },
    },
    // Healing makes the model whole (pressure-drop ledger 2026-10-20): the Heal row of a group
    // previews its caps and joins in Revit, rolled back, then heals what passed in one transaction.
    "heal-preview": {
      label: "preview heal",
      does: "ducts.preview-heal",
      // The inbox's Heal row draws it.
      visible: false,
      input: healInput,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      // Without an input this answers for the verb at large; the Heal row asks with its group.
      ready: (ctx, input) => (groupOf(input) ? why(() => healOf(ctx, groupOf(input))) : null),
      run: async (ctx, input) => {
        const group = groupOf(input)!;
        const { snapshot, found } = healOf(ctx, group);
        const response = await dispatch<DuctsHeal.Res.Response>(ctx, "ducts.preview-heal", {
          groups: [healRequestGroup(found)],
        });
        ctx.setPage({
          heal: {
            group,
            mode: "preview",
            epoch: ctx.page.epoch,
            response,
            before: espBefore(ctx, snapshot, group),
          },
        });
        ctx.note(
          "heal preview",
          `${networkWord(snapshot, group)}: ${healWords(response)}`,
          response.counts.refused > 0,
        );
      },
    },
    heal: {
      label: "heal",
      does: "ducts.apply-heal",
      visible: false,
      input: healInput,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      // Armed only by a preview of this group over this snapshot: what heals is what the person saw pass.
      ready: (ctx, input) => {
        const run = ctx.page.heal;
        const group = groupOf(input);
        if (!group) return null;
        if (run?.mode !== "preview" || run.group !== group) return "Preview the heal first";
        if (run.epoch !== ctx.page.epoch)
          return "The snapshot changed since the preview; preview again";
        return passedOf(run).size ? null : "Nothing passed the preview";
      },
      run: async (ctx, input) => {
        const run = ctx.page.heal!;
        const group = groupOf(input)!;
        const { snapshot, found } = healOf(ctx, group);
        const response = await dispatch<DuctsHeal.Res.Response>(ctx, "ducts.apply-heal", {
          groups: [healRequestGroup(found, passedOf(run))],
        });
        ctx.note(
          "heal",
          `${networkWord(snapshot, group)}: ${healWords(response)}`,
          response.counts.refused > 0,
        );
        // Revit renumbers what it rebuilt: read the snapshot again, and keep the before for the row.
        ctx.setPage({
          heal: { ...run, mode: "apply", response },
          epoch: ctx.page.epoch + 1,
          evaluation: null,
        });
      },
    },
  },
});

/** The item keys a heal preview passed. */
export const passedOf = (run: DuctsHealRun) =>
  new Set(
    run.response.groups.flatMap((g) =>
      g.items.filter((i) => i.outcome === "planned").map((i) => i.key),
    ),
  );
