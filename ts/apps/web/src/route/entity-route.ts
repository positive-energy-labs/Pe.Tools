/**
 * The entity route kernel (rulings 34-45): `/family`, `/families` and `/schedules` declare an
 * `EntityRouteDef` and `entityRoute` turns it, with the audit's own pieces, into a `RouteManifest`.
 */
import { noteCaptured } from "./inspect";
import type { PodList } from "@pe/host-contracts/operation-types";
import { previousOf } from "#/readings";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  hostActions,
  sameValue,
  stagedEntries,
  type Reading,
  type Rung,
  type RouteKey,
  type RoutePage,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import { isSpecOf, workflow } from "./workflow";
import { refuse, type Refusal } from "./refusal";
import { NATIVE_APPLY_WAIT_S, NATIVE_READ_WAIT_S } from "./waits";
import {
  defineRoute,
  type Ctx,
  type PageTransition,
  type ReadingSpec,
  type RouteAction,
  type RouteManifest,
} from "./manifest";

/** A pod member's address, everywhere (dogma law 11). */
export interface MemberRef {
  pod: string;
  path: string;
}

/** One `pod.list` row, as the host projects it. */
export type PodRow = PodList["pods"][number];

/** Every entity route's stages (rulings 34-40): Auditing, Applying, History (inspection only; MAP ruling 58). */
export type EntityStage = EntityFields["stage"];
export type EntityAction = "capture" | "apply";
const ENTITY_STAGES = [
  { key: "audit", word: "Auditing" },
  { key: "apply", word: "Applying" },
  { key: "history", word: "History" },
] as const satisfies readonly { key: EntityStage; word: string }[];
export const HISTORY = "History is inspection only";
/** The Reading every entity route shares: the installed pods, provided by the route's owner. */
export type EntityReading = "pods";

/** One row of the confirmation sheet: what apply would do to one subject. */
export interface PlanEntry {
  id: string;
  name: string;
  planHash: string;
  /** Concrete edits the plan compiled. */
  actions: number;
  /** Where the edits came from, as the plan reported it. */
  detail: string;
  /** Why this row cannot be applied (a refusal, or nothing to do); null = applicable. */
  flag: string | null;
  warnings: readonly string[];
  /** The plan action this row came from; apply names it, and the host consumes its sealed input. */
  plan?: string;
  /** The key apply's `expectedPlanHashes` uses for this row, when it is not `id` (a family's id
   * as that plan resolved its name: a wire fact of the sealed plan, never the row's identity). */
  hashKey?: string;
}

/** The plan apply confirms (dogma law 9), as the plan workflow returned it. */
export interface PlanSheet {
  entries: readonly PlanEntry[];
  /**
   * The staged value at each cell a staged plan read, as it was when planned: the plan's own
   * evidence. A cell that no longer holds it makes the sheet stale, the host's refusal rule.
   */
  staged?: Readonly<Record<string, Rung>>;
  /** The rows the plan says were held back, and who held each: the host's words, by name. */
  held?: readonly HeldRow[];
}

export interface HeldRow {
  name: string;
  by: "person" | "pea";
}

/** The host's words for a plan whose staged cells moved; the sheet says them before the press. */
export const STALE_PLAN = "The staged cells changed since this plan; plan again";

/**
 * The fields every entity route's contract declares (agent-contracts `routes/entity.ts`): stage,
 * the opened member (`pod`, `path`: capture lands there, apply reads it; empty = none) and the
 * right pane. Each route's page schema extends its own `routeAddress(route).schema`.
 */
type EntityFields = Pick<RoutePage<"schedules">, "stage" | "pod" | "path" | "pane">;

export interface EntityPage extends EntityFields {
  /** The confirmation sheet is open. Page, never URL: its sheet is a plan read no link reopens. */
  confirming: boolean;
  /** The sheet the plan read returned. */
  sheet: PlanSheet | null;
}

const entityPage = z.object({
  confirming: z.boolean().default(false),
  sheet: z.custom<PlanSheet>().nullable().default(null),
});

/** What a plan lane reads to draw its sheet: the handle's view, with no host reach. */
export type EntityView<W, R extends string, P> = Pick<
  Ctx<W, R | EntityReading, P & EntityPage>,
  "work" | "readings" | "page"
>;

interface MemberSource extends MemberRef {
  sha256: string;
}

/**
 * Apply as a confirmation (dogma law 9): `read` plans the saved spec and returns the sheet, the
 * page holds it, and `apply` writes exactly the included rows' hashes.
 */
export interface ApplyPlan<W, R extends string, P> {
  read: (ctx: ECtx<W, R, P>, source: MemberSource) => Promise<PlanSheet>;
  /** Rows held back from apply; the route holds them where its host checks them. */
  excluded?: (view: EntityView<W, R, P>) => readonly string[];
  apply: (ctx: ECtx<W, R, P>, rows: readonly PlanEntry[], source: MemberSource) => Promise<void>;
  /**
   * Apply confirms the plan in a second press (`/families` only, MAP ruling 52); absent = one
   * press plans and applies, and stops on a row the plan refuses. Both of the route's lanes follow it.
   */
  confirm?: true;
}

/** What an entity route's own hooks receive: its audit's ctx plus the entity page and pods. */
type ECtx<W, R extends string, P> = Ctx<W, R | EntityReading, P & EntityPage>;

/** An entity route, declared once: `/family`, `/families`, `/schedules` differ only here. */
export interface EntityRouteDef<W, R extends string, P> {
  key: string;
  name: string;
  /** The noun a captured member is filed under: `settings/<entity>/…`. */
  entity: string;
  /**
   * The spec `$schema` path(s) (`/schemas/settings/…`); the only thing that says a member is this
   * route's. The first is what a new draft is written against.
   */
  schema: string | readonly [string, ...string[]];
  /** The host workflow that captures into the route's pod and returns the new member(s). */
  capture?: SemanticActionKey;
  /** The host workflow that applies a saved spec in one step, when there is no plan. */
  apply: SemanticActionKey;
  /** The audit Readings an apply changes in Revit (a new schedule joins the catalog): its
   * completion re-reads them, so the route never shows a pre-apply count. */
  applies?: readonly R[];
  plan?: ApplyPlan<W, R, P>; // present = apply is a confirmation over this plan
  /** `explicit`: the route keeps a drawn `read` verb (ruling 42); otherwise its `read` is hidden. */
  read?: "explicit";
  /** An opened spec loads into the audit's draft (`/family`), so staged cells over it may apply. */
  specIsDraft?: true;
  /**
   * Present = the audit stages edits of its own, and apply takes them before any opened member: a
   * plan lane generates the spec from them at that moment (dogma law 10), or they write directly.
   */
  staged?: {
    /** The audit's keyed cells; the staged ones are what plan generates the spec from. */
    cells: (ctx: ECtx<W, R, P>) => Readonly<Record<string, { staged?: Rung | null }>>;
    /** Absent = apply writes the staged cells in one press, with no sheet (`/schedules`). */
    plan?: (ctx: ECtx<W, R, P>) => Promise<PlanSheet>;
    /** Why the staged cells cannot be written now, beyond the kernel's checks; null = they can. */
    ready?: (ctx: ECtx<W, R, P>) => string | null;
    /** Resolves to the apply's own outcome when it has one (partial, refused, failed). */
    apply: (ctx: ECtx<W, R, P>, included: readonly PlanEntry[]) => Promise<Refusal | null | void>;
  };
  /**
   * What the route needs bound before it reads anything; default `project`. The verbs need what
   * their host workflow's contract says (`family.apply` needs a family document).
   */
  needs?: RouteManifest<W, R, P, never>["needs"];
  /** Where the Situation offers the spec picker; default `apply`. `always` = the audit edits a member. */
  specPicker?: "always" | "apply";
  /** What the route does with the capture workflow's whole result (evidence beside the new member). */
  onCaptured?: (result: Record<string, unknown>, ctx: ECtx<W, R, P>) => void;
  /** What capture needs beyond the pod, read off the audit; a string refuses. */
  captureInput?: (ctx: ECtx<W, R, P>) => Record<string, unknown> | string;
  /** Refuse planning/apply when route-owned edits belong to another exact document. */
  targetReady?: (ctx: ECtx<W, R, P>) => string | null;
  docs?: ReactNode;
}

type EntityCtx = Ctx<unknown, string, EntityPage>;
type Viewed = { page: EntityPage; readings: Readonly<Record<string, Reading<unknown>>> };

/** A re-reading pod list still answers with what it last saw; only "never read" is empty. */
const podsOf = (view: Viewed) =>
  (previousOf(view.readings.pods) as readonly PodRow[] | undefined) ?? [];

/** The saved member the page names, if the pod list holds it. */
const memberOf = (view: Viewed) =>
  podsOf(view)
    .find((row) => row.id === view.page.pod)
    ?.members.find((row) => row.path === view.page.path);

/** The sheet the route draws, and which of its rows apply would send. */
export function sheetOf<W, R extends string, P>(
  def: EntityRouteDef<W, R, P>,
  view: EntityView<W, R, P>,
): {
  sheet: PlanSheet;
  excluded: ReadonlySet<string>;
  included: readonly PlanEntry[];
  stale: boolean;
} | null {
  const sheet = view.page.sheet;
  if (!sheet) return null;
  const excluded = new Set(def.plan?.excluded?.(view) ?? []);
  const now = sheet.staged && def.staged ? def.staged.cells(view as never) : {};
  return {
    sheet,
    excluded,
    included: sheet.entries.filter((entry) => !entry.flag && !excluded.has(entry.id)),
    stale: Object.entries(sheet.staged ?? {}).some(
      ([cell, rung]) => !sameValue(now[cell]?.staged, rung),
    ),
  };
}

/**
 * The one entity route (rulings 34-45): stages Auditing, Applying, History; `capture` (Auditing)
 * files the audit as a spec; `apply` (Applying) takes the staged cells, else the opened spec, and
 * with a plan lane press 1 plans and opens the sheet, press 2 sends it. The audit's own verbs ride
 * in `audit`; its `read` is drawn only when the def declares `read: "explicit"`.
 */
export function entityRoute<W, const R extends string, P extends object, const A extends string>(
  def: EntityRouteDef<W, R, P>,
  audit: Pick<
    RouteManifest<W, R, P, A>,
    | "work"
    | "workKey"
    | "cells"
    | "inspectables"
    | "readings"
    | "page"
    | "actions"
    | "runs"
    | "seeds"
  > & {
    /** The route's contract address: its fields are the entity fields plus the route's own. */
    address: RouteKey;
    /** Extends `routeAddress(address).schema` with the audit's Page-only state. */
    page: z.ZodType<P & EntityFields>;
    transition?: PageTransition<P & EntityPage>;
  },
): RouteManifest<W, R | EntityReading, P & EntityPage, A | EntityAction> {
  const plan = def.plan as ApplyPlan<unknown, string, object> | undefined;
  const staged = def.staged as EntityRouteDef<unknown, string, object>["staged"];
  /** How many edits the audit has staged; 0 = apply reads the page's saved member instead. */
  const stagedCells = (ctx: EntityCtx) =>
    stagedEntries(staged?.cells(ctx as never) ?? {}) as [string, { staged: Rung }][];
  const stagedCount = (ctx: EntityCtx) => stagedCells(ctx).length;
  const sourceOf = (ctx: EntityCtx): MemberSource => {
    const member = memberOf(ctx);
    if (!member) throw Error("save the spec before applying");
    return { pod: ctx.page.pod, path: ctx.page.path, sha256: member.sha256 };
  };
  /** The opened member, checked; a refusal says which half is missing. */
  const savedSpec = (ctx: EntityCtx) => {
    if (!ctx.page.pod || !ctx.page.path) return "open a saved spec first";
    const member = memberOf(ctx);
    if (!member) return "save the spec before applying";
    return isSpecOf(member.schema, def.schema) ? null : `the member is not a ${def.entity} spec`;
  };
  const inHistory = (ctx: EntityCtx) => (ctx.page.stage === "history" ? HISTORY : null);
  /** What apply takes now: the staged cells, else the opened spec. */
  const objectOf = (ctx: EntityCtx) => (stagedCount(ctx) ? "cells" : ctx.page.path ? "spec" : null);
  const lane = (ctx: EntityCtx) => (objectOf(ctx) === "cells" ? staged?.plan : plan);
  /** The open sheet press 2 sends: current, and planned from what apply takes now. */
  const sending = (ctx: EntityCtx) => {
    const view = ctx.page.confirming ? sheetOf(def as never, ctx as never) : null;
    return view && !view.stale && Boolean(view.sheet.staged) === (objectOf(ctx) === "cells")
      ? view
      : null;
  };
  const confirm = Boolean(def.plan?.confirm);
  /** Press 1 of a confirmed apply: it plans and opens the sheet, and changes nothing. */
  const planning = (ctx: EntityCtx) => confirm && Boolean(lane(ctx)) && !sending(ctx);
  const capture: RouteAction<unknown, string, EntityPage, never> = {
    waitSeconds: NATIVE_READ_WAIT_S,
    label: `capture ${def.entity}`,
    does: def.capture!,
    input: z.void() as unknown as z.ZodType<never>,
    dirties: ["pods"],
    stage: "audit",
    ready: (ctx) => {
      if (inHistory(ctx)) return HISTORY;
      if (!ctx.page.pod) return "choose the pod the capture lands in";
      const extra = def.captureInput?.(ctx as never);
      return typeof extra === "string" ? extra : null;
    },
    run: async (ctx) => {
      const extra = def.captureInput?.(ctx as never);
      if (typeof extra === "string") throw Error(extra);
      // The host captures and files the new members; the page lands on the first it wrote.
      const result = await workflow(def.capture!, { pod: ctx.page.pod, ...extra }, ctx);
      const members = (result.members ?? [result.member]) as MemberRef[];
      // The page lands on what the capture wrote; only the person changes the stage.
      if (members[0]) ctx.setPage({ path: members[0].path });
      noteCaptured(ctx, def.entity, members);
      def.onCaptured?.(result, ctx as never);
    },
  };
  const apply: RouteAction<unknown, string, EntityPage, never> = {
    waitSeconds: NATIVE_APPLY_WAIT_S,
    label: "apply",
    labelNow: (ctx) => {
      const n = stagedCount(ctx);
      if (n) return `apply ${n} cell${n === 1 ? "" : "s"}`;
      return ctx.page.path ? `apply spec ${ctx.page.path.split("/").at(-1)}` : "apply";
    },
    does: def.apply,
    saysNow: (ctx) =>
      planning(ctx)
        ? `plans ${objectOf(ctx) === "cells" ? "the staged cells (filed nowhere)" : `the saved ${def.entity} spec`} and opens the confirmation sheet; changes nothing. Press again to apply.`
        : objectOf(ctx) === "cells" && !staged?.plan
          ? "writes the staged cells to Revit, then reads them back"
          : lane(ctx) && !confirm
            ? `plans and applies ${objectOf(ctx) === "cells" ? "the staged cells" : `the saved ${def.entity} spec`} in one press; stops if the plan refuses a row`
            : hostActions[def.apply].says,
    plans: planning,
    input: z.void() as unknown as z.ZodType<never>,
    dirties: ["pods", ...(def.applies ?? [])],
    stage: "apply",
    ready: (ctx) => {
      const refusal = inHistory(ctx) ?? def.targetReady?.(ctx as never);
      if (refusal) return refusal;
      const object = objectOf(ctx);
      if (object === "cells") {
        if (ctx.page.path && !def.specIsDraft) return "unstage or apply the staged cells first";
        const cells = staged?.ready?.(ctx as never);
        if (cells) return cells;
      } else if (object === "spec") {
        const missing = savedSpec(ctx);
        if (missing) return missing;
      } else return staged ? "stage a cell or open a saved spec first" : "open a saved spec first";
      if (!lane(ctx)) return null;
      // Press 1 plans; press 2 sends the open sheet's included rows.
      const view = sending(ctx);
      return !view || view.included.length ? null : "no included row has changes to apply";
    },
    run: async (ctx) => {
      const cells = objectOf(ctx) === "cells";
      if (!lane(ctx)) {
        // One press: the route writes its cells, or the host applies the saved bytes it checks.
        if (cells) return (await staged!.apply(ctx as never, [])) ?? null;
        await workflow(def.apply, { source: sourceOf(ctx) }, ctx);
        return null;
      }
      let view = sending(ctx);
      if (!view) {
        // What the plan reads, taken before it reads it: the sheet's staged evidence.
        const was = Object.fromEntries(
          stagedCells(ctx).map(([cell, { staged }]) => [cell, staged]),
        );
        const sheet = cells
          ? { ...(await staged!.plan!(ctx as never)), staged: was }
          : await plan!.read(ctx as never, sourceOf(ctx));
        if (confirm) {
          // The sheet opens over whatever stage the person is in (F-B-8).
          ctx.setPage({ confirming: true, sheet }, ["stage", "pod", "path"]);
          return null;
        }
        // One press (ruling 52): the staged edits were the preview; a refused row stops it.
        const flagged = sheet.entries.find((entry) => entry.flag);
        if (flagged || !sheet.entries.length)
          return refuse(
            "not-ready",
            flagged ? `${flagged.name}: ${flagged.flag}` : "the plan has no changes to apply",
          );
        view = { sheet, excluded: new Set(), included: sheet.entries, stale: false };
      }
      // A staged apply may report its own outcome (applied X of N, refused, failed in Revit).
      const outcome = cells
        ? await staged!.apply(ctx as never, view.included)
        : await plan!.apply(ctx as never, view.included, sourceOf(ctx));
      ctx.setPage({ confirming: false, sheet: null }, ["sheet", "stage", "pod", "path"]);
      return outcome ?? null;
    },
  };
  // Only a def that declares its read explicit draws it; any other `read` runs hidden (ruling 42).
  const read = (audit.actions as Record<string, RouteAction<W, R, P, never>> | undefined)?.read;
  return defineRoute({
    key: def.key,
    name: def.name,
    docs: def.docs,
    needs: def.needs ?? "project",
    stages: ENTITY_STAGES,
    work: audit.work,
    workKey: audit.workKey,
    cells: audit.cells,
    inspectables: audit.inspectables,
    // `pods` is provided by the route's owner (a live `pod.list`, or the seed); never subscribed.
    readings: { ...audit.readings, pods: () => null } as Record<
      R | EntityReading,
      ReadingSpec<P & EntityPage>
    >,
    page: z.intersection(audit.page, entityPage) as z.ZodType<P & EntityPage>,
    transition: (current, patch, origin) => {
      const normalized = audit.transition?.(current, patch, origin) ?? { patch };
      if ("refusal" in normalized) return normalized;
      const identityChanged = (["stage", "pod", "path"] as const).some(
        (key) => Object.hasOwn(normalized.patch, key) && normalized.patch[key] !== current[key],
      );
      return {
        patch: identityChanged
          ? { ...normalized.patch, confirming: false, sheet: null }
          : normalized.patch,
      };
    },
    // Stage, pod and path are the contract's entity fields, so `/pods` deep-links a spec.
    address: audit.address,
    actions: {
      ...audit.actions,
      ...(read && def.read !== "explicit" ? { read: { ...read, visible: false } } : {}),
      ...(def.capture ? { capture } : {}),
      apply,
    } as never,
    runs: audit.runs,
    seeds: audit.seeds as never,
  });
}
